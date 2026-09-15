import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { PrintResult } from "@/printing/printer-provider";
import { getTestDb, seedTestFixture } from "./helpers";
import { submitOrder } from "@/server/services/order-service";
import {
  createReprintJob,
  PRINT_JOB_MAX_ATTEMPTS,
  processPrintJob,
  recoverAbandonedPrintJobs,
  UNCERTAIN_PRINT_ERROR,
} from "@/server/services/print-service";

// A controllable printer: prints succeed instantly unless a test swaps in
// its own behaviour (slow, failing) through `printer.next`.
const printer = vi.hoisted(() => ({ next: null as null | (() => Promise<PrintResult> | PrintResult), calls: 0 }));
vi.mock("@/printing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/printing")>();
  return {
    ...actual,
    getPrinterProvider: () => ({
      name: "mock" as const,
      testConnection: async () => ({ connected: true }),
      getStatus: async () => ({ online: true }),
      print: async () => {
        printer.calls += 1;
        return printer.next ? printer.next() : { success: true };
      },
    }),
  };
});

const dbA = getTestDb();
const dbB = getTestDb();
afterAll(async () => Promise.all([dbA?.$client.end(), dbB?.$client.end()]));
beforeEach(() => {
  printer.next = null;
  printer.calls = 0;
});

async function orderWithQueuedJob() {
  const fixture = await seedTestFixture(dbA!);
  const actor = { businessId: fixture.business.id, userId: fixture.user.id };
  const { order } = await submitOrder(dbA!, actor, {
    idempotencyKey: randomUUID(),
    orderType: "dine_in",
    discountTotal: 0,
    lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 1, modifierOptionIds: [] }],
  });
  const [job] = await dbA!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, order.id));
  return { ...fixture, actor, order, job };
}

const jobById = async (id: string) => (await dbA!.select().from(schema.printJobs).where(eq(schema.printJobs.id, id)))[0];

describe.skipIf(!dbA)("print job claims and recovery (PostgreSQL)", () => {
  it("lets only one of several concurrent workers print a job", async () => {
    const { job } = await orderWithQueuedJob();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => processPrintJob(i % 2 ? dbA! : dbB!, job.id)));

    expect(printer.calls).toBe(1);
    expect(results.filter((r) => r.status === "PRINTED").length).toBeGreaterThanOrEqual(1);
    const saved = await jobById(job.id);
    expect(saved).toMatchObject({ status: "PRINTED", attemptCount: 1, claimToken: null, leaseExpiresAt: null });
  });

  it("marks an abandoned claim FAILED with an unknown outcome instead of reprinting it", async () => {
    const { job, business } = await orderWithQueuedJob();
    await dbA!
      .update(schema.printJobs)
      .set({ status: "PROCESSING", attemptCount: 1, claimToken: randomUUID(), leaseExpiresAt: new Date(Date.now() - 60_000), processedAt: new Date(Date.now() - 120_000) })
      .where(eq(schema.printJobs.id, job.id));

    // A worker can't claim it while it's still held, and nothing prints.
    expect(await processPrintJob(dbA!, job.id)).toEqual({ status: "PROCESSING" });
    expect(printer.calls).toBe(0);

    const other = await seedTestFixture(dbA!);
    expect(await recoverAbandonedPrintJobs(dbA!, other.business.id)).toBe(0);
    expect(await recoverAbandonedPrintJobs(dbA!, business.id)).toBe(1);
    expect(await jobById(job.id)).toMatchObject({ status: "FAILED", lastError: UNCERTAIN_PRINT_ERROR, attemptCount: 1, claimToken: null });
    expect(printer.calls).toBe(0);
  });

  it("leaves a claim with a live lease alone", async () => {
    const { job, business } = await orderWithQueuedJob();
    await dbA!
      .update(schema.printJobs)
      .set({ status: "PROCESSING", attemptCount: 1, claimToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000), processedAt: new Date() })
      .where(eq(schema.printJobs.id, job.id));
    expect(await recoverAbandonedPrintJobs(dbA!, business.id)).toBe(0);
    expect((await jobById(job.id)).status).toBe("PROCESSING");
  });

  it("ignores a stale worker's result after its job was recovered and printed by a newer attempt", async () => {
    const { job, business } = await orderWithQueuedJob();
    let finishSlowPrint!: (result: PrintResult) => void;
    printer.next = () => new Promise<PrintResult>((resolve) => (finishSlowPrint = resolve));

    const staleWorker = processPrintJob(dbA!, job.id);
    await vi.waitFor(async () => expect((await jobById(job.id)).status).toBe("PROCESSING"));
    await vi.waitFor(() => expect(finishSlowPrint).toBeTypeOf("function"));

    // The slow worker's lease runs out; recovery and a new attempt take over.
    await dbA!.update(schema.printJobs).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(schema.printJobs.id, job.id));
    expect(await recoverAbandonedPrintJobs(dbA!, business.id)).toBe(1);
    printer.next = null;
    expect(await processPrintJob(dbB!, job.id)).toEqual({ status: "PRINTED" });

    finishSlowPrint({ success: false, error: "late failure" });
    expect(await staleWorker).toMatchObject({ status: "PROCESSING", error: expect.stringMatching(/superseded/) });
    expect(await jobById(job.id)).toMatchObject({ status: "PRINTED", lastError: null, attemptCount: 2 });
  });

  it("records failures and stops retrying at the attempt limit", async () => {
    const { job } = await orderWithQueuedJob();
    printer.next = () => ({ success: false, error: "Paper out" });

    for (let i = 0; i < PRINT_JOB_MAX_ATTEMPTS; i++) {
      expect(await processPrintJob(dbA!, job.id)).toEqual({ status: "FAILED", error: "Paper out" });
    }
    expect(await processPrintJob(dbA!, job.id)).toMatchObject({ status: "FAILED", error: expect.stringMatching(/retry limit/) });
    expect(printer.calls).toBe(PRINT_JOB_MAX_ATTEMPTS);
    expect(await jobById(job.id)).toMatchObject({ status: "FAILED", attemptCount: PRINT_JOB_MAX_ATTEMPTS, lastError: "Paper out" });
  });

  it("returns the same job when a reprint request is retried, and a new job for a new request", async () => {
    const { actor, order } = await orderWithQueuedJob();

    const concurrent = await Promise.all([
      createReprintJob(dbA!, actor, order.id, "reprint-1"),
      createReprintJob(dbB!, actor, order.id, "reprint-1"),
    ]);
    expect(concurrent.map((r) => r.status)).toContain("PRINTED");
    const retried = await createReprintJob(dbA!, actor, order.id, "reprint-1");
    expect(retried.status).toBe("PRINTED");

    await createReprintJob(dbA!, actor, order.id, "reprint-2");
    const reprints = await dbA!
      .select()
      .from(schema.printJobs)
      .where(and(eq(schema.printJobs.orderId, order.id), isNotNull(schema.printJobs.requestKey)));
    expect(reprints.map((r) => r.requestKey).sort()).toEqual(["reprint-1", "reprint-2"]);
    expect(reprints.every((r) => r.attemptCount === 1)).toBe(true);
    expect(printer.calls).toBe(2);
  });
});
