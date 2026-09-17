import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTestDb, seedTestFixture } from "./helpers";
import { submitOrder } from "@/server/services/order-service";
import { submitOrderForUser } from "@/server/services/checkout";
import {
  createReprintJob,
  DEVICE_PRINT_ELSEWHERE_ERROR,
  processPrintJob,
  recordDevicePrintResult,
  recoverAbandonedPrintJobs,
  retryPrintJob,
  UNCERTAIN_PRINT_ERROR,
} from "@/server/services/print-service";

/**
 * The `device` provider's server half: the printer is paired with the staff
 * tablet, so the server can only authorize one attempt, hand the payload
 * over, and record what the tablet reports back for that attempt. The
 * Bluetooth half is covered by the ESC/POS unit tests and by /print-test on
 * the real hardware.
 */
const dbA = getTestDb();
const dbB = getTestDb();
afterAll(async () => Promise.all([dbA?.$client.end(), dbB?.$client.end()]));

const originalProvider = process.env.PRINT_PROVIDER;
beforeEach(() => {
  process.env.PRINT_PROVIDER = "device";
});
afterEach(() => {
  if (originalProvider === undefined) delete process.env.PRINT_PROVIDER;
  else process.env.PRINT_PROVIDER = originalProvider;
});

const POS = { deviceCapable: true } as const;
const LINE = (fixture: Awaited<ReturnType<typeof seedTestFixture>>) => [
  { menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 1, modifierOptionIds: [] },
];

async function orderWithDeviceJob() {
  const fixture = await seedTestFixture(dbA!);
  const actor = { businessId: fixture.business.id, userId: fixture.user.id };
  const { order } = await submitOrder(dbA!, actor, {
    idempotencyKey: randomUUID(),
    orderType: "dine_in",
    discountTotal: 0,
    lines: LINE(fixture),
  });
  const [job] = await dbA!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, order.id));
  return { ...fixture, actor, order, job };
}

/** Claims the device attempt a POS screen would get, returning its token. */
async function claim(jobId: string, db = dbA!) {
  const result = await processPrintJob(db, jobId, POS);
  expect(result.requiresClientAction).toBe("device_print");
  return result.attemptToken!;
}

const jobById = async (id: string) => (await dbA!.select().from(schema.printJobs).where(eq(schema.printJobs.id, id)))[0];

async function saleMovements(orderId: string) {
  return dbA!
    .select()
    .from(schema.inventoryMovements)
    .where(and(eq(schema.inventoryMovements.sourceId, orderId), eq(schema.inventoryMovements.movementType, "SALE_CONSUMPTION")));
}

describe.skipIf(!dbA)("device (tablet Bluetooth) printing", () => {
  it("queues the receipt against the device provider on checkout", async () => {
    const { job } = await orderWithDeviceJob();
    expect(job.provider).toBe("device");
    expect(job.status).toBe("QUEUED");
    expect(job.payloadSnapshot).toMatchObject({ orderNumber: expect.any(String) });
  });

  it("hands the payload to the tablet and keeps the attempt claimed until it reports back", async () => {
    const { job } = await orderWithDeviceJob();
    const result = await processPrintJob(dbA!, job.id, POS);

    expect(result.requiresClientAction).toBe("device_print");
    expect(result.printJobId).toBe(job.id);
    expect(result.attemptToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.payload?.orderNumber).toBe((job.payloadSnapshot as { orderNumber: string }).orderNumber);

    const after = await jobById(job.id);
    expect(after.status).toBe("PROCESSING");
    expect(after.claimToken).toBe(result.attemptToken);
    expect(after.leaseExpiresAt).not.toBeNull();
    expect(after.printedAt).toBeNull();
    expect(after.attemptCount).toBe(1);
  });

  it("marks the job printed when the tablet reports success for its attempt", async () => {
    const { job, actor } = await orderWithDeviceJob();
    const token = await claim(job.id);

    const result = await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: true });
    expect(result.status).toBe("PRINTED");
    expect(await jobById(job.id)).toMatchObject({ status: "PRINTED", lastError: null, claimToken: null, leaseExpiresAt: null });
    expect((await jobById(job.id)).printedAt).not.toBeNull();
  });

  it("records the tablet's failure, capping the stored error length", async () => {
    const { job, actor } = await orderWithDeviceJob();
    const token = await claim(job.id);

    const result = await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: false, error: "x".repeat(5_000) });
    expect(result.status).toBe("FAILED");
    expect((await jobById(job.id)).lastError).toHaveLength(500);
  });

  it("stays printed when a flaky tablet reports the same success twice", async () => {
    const { job, actor } = await orderWithDeviceJob();
    const token = await claim(job.id);
    await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: true });
    const printedAt = (await jobById(job.id)).printedAt;

    const second = await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: true });
    expect(second.status).toBe("PRINTED");
    expect((await jobById(job.id)).printedAt).toEqual(printedAt);
  });

  it("does not let a late failure report undo a receipt already printed", async () => {
    const { job, actor } = await orderWithDeviceJob();
    const token = await claim(job.id);
    await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: true });

    const late = await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: false, error: "connection lost" });
    expect(late.status).toBe("PRINTED");
    expect(await jobById(job.id)).toMatchObject({ status: "PRINTED", lastError: null });
  });

  it("never leaves a successful attempt FAILED when success and failure race on separate connections", async () => {
    for (let round = 0; round < 5; round++) {
      const { job, actor } = await orderWithDeviceJob();
      const token = await claim(job.id);

      const [success, failure] = await Promise.all([
        recordDevicePrintResult(dbA!, actor, job.id, token, { ok: true }),
        recordDevicePrintResult(dbB!, actor, job.id, token, { ok: false, error: "late" }),
      ]);
      const saved = await jobById(job.id);
      // Exactly one report lands; the other sees the winner's status.
      expect([success.status, failure.status]).toEqual([saved.status, saved.status]);
      expect(["PRINTED", "FAILED"]).toContain(saved.status);
      if (saved.status === "PRINTED") expect(saved.lastError).toBeNull();
    }
  });

  it("does not let a report overwrite a cancelled job", async () => {
    const { job, actor } = await orderWithDeviceJob();
    const token = await claim(job.id);
    // Whatever cancelled the job, a late tablet report must not reopen it.
    await dbA!.update(schema.printJobs).set({ status: "CANCELLED" }).where(eq(schema.printJobs.id, job.id));

    expect((await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: true })).status).toBe("CANCELLED");
    expect((await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: false })).status).toBe("CANCELLED");
    expect(await jobById(job.id)).toMatchObject({ status: "CANCELLED", printedAt: null });
  });

  it("does not let an older attempt complete or fail a newer one", async () => {
    const { job, actor, business } = await orderWithDeviceJob();
    const oldToken = await claim(job.id);

    // The first attempt's lease runs out; recovery closes it and staff retry.
    await dbA!.update(schema.printJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(schema.printJobs.id, job.id));
    expect(await recoverAbandonedPrintJobs(dbA!, business.id)).toBe(1);
    const newToken = await claim(job.id);
    expect(newToken).not.toBe(oldToken);

    const staleFailure = await recordDevicePrintResult(dbA!, actor, job.id, oldToken, { ok: false, error: "old" });
    const staleSuccess = await recordDevicePrintResult(dbA!, actor, job.id, oldToken, { ok: true });
    expect(staleFailure.status).toBe("PROCESSING");
    expect(staleSuccess.status).toBe("PROCESSING");
    expect(await jobById(job.id)).toMatchObject({ status: "PROCESSING", claimToken: newToken, attemptCount: 2 });

    expect((await recordDevicePrintResult(dbA!, actor, job.id, newToken, { ok: true })).status).toBe("PRINTED");
  });

  it("refuses a job belonging to another business", async () => {
    const { job } = await orderWithDeviceJob();
    const token = await claim(job.id);
    const stranger = await seedTestFixture(dbA!);

    await expect(
      recordDevicePrintResult(dbA!, { businessId: stranger.business.id }, job.id, token, { ok: true }),
    ).rejects.toThrow(/not found/i);
    expect(await jobById(job.id)).toMatchObject({ status: "PROCESSING", claimToken: token });
  });

  it("rejects a malformed attempt token without touching the job", async () => {
    const { job, actor } = await orderWithDeviceJob();
    await claim(job.id);
    await expect(recordDevicePrintResult(dbA!, actor, job.id, "not-a-token", { ok: true })).rejects.toThrow(/token/i);
    expect((await jobById(job.id)).status).toBe("PROCESSING");
  });

  it("refuses to mark a server-side provider's job as printed", async () => {
    process.env.PRINT_PROVIDER = "mock";
    const fixture = await seedTestFixture(dbA!);
    const actor = { businessId: fixture.business.id, userId: fixture.user.id };
    const { order } = await submitOrder(dbA!, actor, {
      idempotencyKey: randomUUID(),
      orderType: "dine_in",
      discountTotal: 0,
      lines: LINE(fixture),
    });
    const [job] = await dbA!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, order.id));
    // Even a job pinned in PROCESSING with a known token can't be completed as a device job.
    const token = randomUUID();
    await dbA!.update(schema.printJobs).set({ status: "PROCESSING", claimToken: token }).where(eq(schema.printJobs.id, job.id));

    await expect(recordDevicePrintResult(dbA!, actor, job.id, token, { ok: true })).rejects.toThrow(/not printed by the tablet/i);
    expect((await jobById(job.id)).status).toBe("PROCESSING");
  });

  it("authorizes at most one device attempt when several requests race for the same job", async () => {
    const { job } = await orderWithDeviceJob();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => processPrintJob(i % 2 ? dbA! : dbB!, job.id, POS)));

    const authorized = results.filter((r) => r.requiresClientAction === "device_print");
    expect(authorized).toHaveLength(1);
    expect(results.filter((r) => r.attemptToken)).toHaveLength(1);
    expect(await jobById(job.id)).toMatchObject({ status: "PROCESSING", attemptCount: 1, claimToken: authorized[0].attemptToken });
  });

  it("does not let a caller without a Bluetooth printer claim a device attempt", async () => {
    const { job, actor, order } = await orderWithDeviceJob();
    const result = await processPrintJob(dbA!, job.id);
    expect(result).toEqual({ status: "QUEUED", error: DEVICE_PRINT_ELSEWHERE_ERROR });
    expect(await jobById(job.id)).toMatchObject({ status: "QUEUED", attemptCount: 0, claimToken: null });

    await expect(createReprintJob(dbA!, actor, order.id, "admin-tap")).rejects.toThrow(/POS tablet/);
    expect(await dbA!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, order.id))).toHaveLength(1);
    expect((await retryPrintJob(dbA!, actor, job.id)).attemptToken).toBeUndefined();
  });

  it("does not hand a retried checkout a second live authorization", async () => {
    const fixture = await seedTestFixture(dbA!);
    const user = { id: fixture.user.id, businessId: fixture.business.id, roles: ["owner" as const] };
    const input = { idempotencyKey: randomUUID(), orderType: "dine_in", discountTotal: 0, lines: LINE(fixture) };

    const first = await submitOrderForUser(dbA!, user, input);
    if (!first.ok) throw new Error(first.error);
    expect(first.devicePrintJobId).toBeDefined();
    expect(first.devicePrintToken).toBeDefined();

    // The response was "lost"; the tablet retries the same submission while
    // the first attempt is still in flight.
    const retried = await submitOrderForUser(dbA!, user, input);
    if (!retried.ok) throw new Error(retried.error);
    expect(retried.idempotent).toBe(true);
    expect(retried.orderId).toBe(first.orderId);
    expect(retried.printStatus).toBe("PROCESSING");
    expect(retried.devicePrintJobId).toBeUndefined();
    expect(retried.devicePrintToken).toBeUndefined();
    expect(retried.receipt).toBeUndefined();

    // Once the first attempt is recorded as printed, a retry gets nothing to print either.
    await recordDevicePrintResult(dbA!, user, first.devicePrintJobId!, first.devicePrintToken!, { ok: true });
    const afterPrint = await submitOrderForUser(dbA!, user, input);
    expect(afterPrint).toMatchObject({ ok: true, printStatus: "PRINTED", devicePrintToken: undefined });

    // One order, one deduction, one checkout print job.
    expect(await saleMovements(first.orderId)).toHaveLength(1);
    expect(await dbA!.select().from(schema.orders).where(eq(schema.orders.idempotencyKey, input.idempotencyKey))).toHaveLength(1);
  });

  it("gives concurrent checkout retries at most one authorization between them", async () => {
    const fixture = await seedTestFixture(dbA!);
    const user = { id: fixture.user.id, businessId: fixture.business.id, roles: ["owner" as const] };
    const input = { idempotencyKey: randomUUID(), orderType: "dine_in", discountTotal: 0, lines: LINE(fixture) };
    const first = await submitOrderForUser(dbA!, user, input);
    if (!first.ok) throw new Error(first.error);
    // Close the first attempt as failed, so the job is claimable again.
    await recordDevicePrintResult(dbA!, user, first.devicePrintJobId!, first.devicePrintToken!, { ok: false, error: "paper out" });

    const retries = await Promise.all(Array.from({ length: 4 }, (_, i) => submitOrderForUser(i % 2 ? dbA! : dbB!, user, input)));
    const tokens = retries.flatMap((r) => (r.ok && r.devicePrintToken ? [r.devicePrintToken] : []));
    expect(tokens).toHaveLength(1);
    expect(await saleMovements(first.orderId)).toHaveLength(1);
  });

  it("marks an expired device attempt outcome-unknown and never resends it by itself", async () => {
    const { job, actor, business } = await orderWithDeviceJob();
    const token = await claim(job.id);
    await dbA!.update(schema.printJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(schema.printJobs.id, job.id));

    expect(await recoverAbandonedPrintJobs(dbA!, business.id)).toBe(1);
    expect(await jobById(job.id)).toMatchObject({ status: "FAILED", lastError: UNCERTAIN_PRINT_ERROR, claimToken: null, attemptCount: 1 });

    // Its late report is ignored, and nothing claimed a new attempt on its own.
    expect((await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: true })).status).toBe("FAILED");
    expect(await jobById(job.id)).toMatchObject({ status: "FAILED", attemptCount: 1 });
  });

  it("never rolls back the sale or deducts stock again when printing fails", async () => {
    const { job, actor, order, ingredient } = await orderWithDeviceJob();
    const stockAfterSale = (await dbA!.select().from(schema.ingredients).where(eq(schema.ingredients.id, ingredient.id)))[0]
      .currentQuantityBaseUnits;

    for (let i = 0; i < 3; i++) {
      const token = await claim(job.id);
      await recordDevicePrintResult(dbA!, actor, job.id, token, { ok: false, error: "GATT write failed" });
    }
    await createReprintJob(dbA!, actor, order.id, "after-failures", POS);

    const [savedOrder] = await dbA!.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(savedOrder.status).toBe(order.status);
    expect(await saleMovements(order.id)).toHaveLength(1);
    expect((await dbA!.select().from(schema.ingredients).where(eq(schema.ingredients.id, ingredient.id)))[0].currentQuantityBaseUnits).toBe(
      stockAfterSale,
    );
  });

  it("reprints from order history as a new job the tablet must print", async () => {
    const { order, actor, job } = await orderWithDeviceJob();
    await recordDevicePrintResult(dbA!, actor, job.id, await claim(job.id), { ok: true });

    const reprint = await createReprintJob(dbA!, actor, order.id, "tap-1", POS);
    expect(reprint.requiresClientAction).toBe("device_print");
    expect(reprint.attemptToken).toBeDefined();
    expect(reprint.printJobId).not.toBe(job.id);
    // The reprint carries the order's original snapshot, not today's menu.
    expect(reprint.payload?.orderNumber).toBe((job.payloadSnapshot as { orderNumber: string }).orderNumber);
  });

  it("does not authorize a second send when one reprint tap is retried, even concurrently", async () => {
    const { order, actor } = await orderWithDeviceJob();

    const attempts = await Promise.all([
      createReprintJob(dbA!, actor, order.id, "tap-2", POS),
      createReprintJob(dbB!, actor, order.id, "tap-2", POS),
      createReprintJob(dbA!, actor, order.id, "tap-2", POS),
    ]);
    expect(attempts.filter((r) => r.attemptToken)).toHaveLength(1);
    const retried = await createReprintJob(dbA!, actor, order.id, "tap-2", POS);
    expect(retried.attemptToken).toBeUndefined();
    expect(retried.status).toBe("PROCESSING");

    const jobs = await dbA!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, order.id));
    // The original checkout job plus exactly one reprint, claimed once.
    expect(jobs).toHaveLength(2);
    expect(jobs.find((j) => j.requestKey === "tap-2")?.attemptCount).toBe(1);

    // A new deliberate tap is a new receipt.
    expect((await createReprintJob(dbA!, actor, order.id, "tap-3", POS)).attemptToken).toBeDefined();
  });
});
