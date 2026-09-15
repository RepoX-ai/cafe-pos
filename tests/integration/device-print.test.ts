import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTestDb, seedTestFixture } from "./helpers";
import { submitOrder } from "@/server/services/order-service";
import { processPrintJob, recordDevicePrintResult } from "@/server/services/print-service";

/**
 * The `device` provider's server half: the printer is paired with the staff
 * tablet, so the server can only queue a receipt, hand it over, and record
 * what the tablet reports back. The Bluetooth half is covered by the
 * ESC/POS unit tests and by /print-test on the real hardware.
 */
const db = getTestDb();
afterAll(async () => db?.$client.end());

const originalProvider = process.env.PRINT_PROVIDER;
beforeEach(() => {
  process.env.PRINT_PROVIDER = "device";
});
afterEach(() => {
  if (originalProvider === undefined) delete process.env.PRINT_PROVIDER;
  else process.env.PRINT_PROVIDER = originalProvider;
});

async function orderWithDeviceJob() {
  const fixture = await seedTestFixture(db!);
  const actor = { businessId: fixture.business.id, userId: fixture.user.id };
  const { order } = await submitOrder(db!, actor, {
    idempotencyKey: randomUUID(),
    orderType: "dine_in",
    discountTotal: 0,
    lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 1, modifierOptionIds: [] }],
  });
  const [job] = await db!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, order.id));
  return { ...fixture, actor, order, job };
}

const jobById = async (id: string) => (await db!.select().from(schema.printJobs).where(eq(schema.printJobs.id, id)))[0];

describe.skipIf(!db)("device (tablet Bluetooth) printing", () => {
  it("queues the receipt against the device provider on checkout", async () => {
    const { job } = await orderWithDeviceJob();
    expect(job.provider).toBe("device");
    expect(job.status).toBe("QUEUED");
    expect(job.payloadSnapshot).toMatchObject({ orderNumber: expect.any(String) });
  });

  it("hands the payload to the tablet and releases the claim", async () => {
    const { job } = await orderWithDeviceJob();
    const result = await processPrintJob(db!, job.id);

    expect(result.requiresClientAction).toBe("device_print");
    expect(result.printJobId).toBe(job.id);
    expect(result.payload?.orderNumber).toBe((job.payloadSnapshot as { orderNumber: string }).orderNumber);

    // Still QUEUED and unclaimed — the tablet, not the server, prints it.
    const after = await jobById(job.id);
    expect(after.status).toBe("QUEUED");
    expect(after.claimToken).toBeNull();
    expect(after.leaseExpiresAt).toBeNull();
    expect(after.printedAt).toBeNull();
  });

  it("marks the job printed when the tablet reports success", async () => {
    const { job, actor } = await orderWithDeviceJob();
    await processPrintJob(db!, job.id);

    const result = await recordDevicePrintResult(db!, actor, job.id, { ok: true });
    expect(result.status).toBe("PRINTED");

    const after = await jobById(job.id);
    expect(after.status).toBe("PRINTED");
    expect(after.printedAt).not.toBeNull();
    expect(after.lastError).toBeNull();
  });

  it("records the tablet's failure so the receipt shows up as needing attention", async () => {
    const { job, actor } = await orderWithDeviceJob();
    await processPrintJob(db!, job.id);

    const result = await recordDevicePrintResult(db!, actor, job.id, { ok: false, error: "GATT write failed" });
    expect(result.status).toBe("FAILED");
    expect((await jobById(job.id)).lastError).toBe("GATT write failed");
  });

  it("stays printed when a flaky tablet reports the same success twice", async () => {
    const { job, actor } = await orderWithDeviceJob();
    await processPrintJob(db!, job.id);
    await recordDevicePrintResult(db!, actor, job.id, { ok: true });
    const printedAt = (await jobById(job.id)).printedAt;

    // A retry that arrives late must not reopen or re-time a printed receipt.
    const second = await recordDevicePrintResult(db!, actor, job.id, { ok: true });
    expect(second.status).toBe("PRINTED");
    expect((await jobById(job.id)).printedAt).toEqual(printedAt);
  });

  it("does not let a late failure report undo a receipt already printed", async () => {
    const { job, actor } = await orderWithDeviceJob();
    await processPrintJob(db!, job.id);
    await recordDevicePrintResult(db!, actor, job.id, { ok: true });

    const late = await recordDevicePrintResult(db!, actor, job.id, { ok: false, error: "connection lost" });
    expect(late.status).toBe("PRINTED");
    expect((await jobById(job.id)).status).toBe("PRINTED");
  });

  it("refuses a job belonging to another business", async () => {
    const { job } = await orderWithDeviceJob();
    const stranger = await seedTestFixture(db!);

    await expect(
      recordDevicePrintResult(db!, { businessId: stranger.business.id }, job.id, { ok: true }),
    ).rejects.toThrow(/not found/i);
    expect((await jobById(job.id)).status).toBe("QUEUED");
  });

  it("refuses to mark a server-side provider's job as printed", async () => {
    process.env.PRINT_PROVIDER = "mock";
    const fixture = await seedTestFixture(db!);
    const actor = { businessId: fixture.business.id, userId: fixture.user.id };
    const { order } = await submitOrder(db!, actor, {
      idempotencyKey: randomUUID(),
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 1, modifierOptionIds: [] }],
    });
    const [job] = await db!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, order.id));

    await expect(recordDevicePrintResult(db!, actor, job.id, { ok: true })).rejects.toThrow(/not printed by the tablet/i);
  });
});
