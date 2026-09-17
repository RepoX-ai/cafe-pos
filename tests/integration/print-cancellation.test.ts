import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { seedTestFixture } from "./helpers";
import { cancelOrder, refundOrder, submitOrder } from "@/server/services/order-service";
import {
  createReprintJob,
  PrintNotAllowedError,
  recordDevicePrintResult,
  retryPrintJob,
} from "@/server/services/print-service";

/**
 * Cancellation vs. print authorization, on real PostgreSQL connections.
 *
 * Ordering is forced, not hoped for: a separate "gate" transaction holds the
 * order row lock, the first contender is started and we wait until
 * PostgreSQL reports it blocked on a lock, then the second contender is
 * started and awaited the same way, and only then is the gate released.
 * Row-lock waiters are granted in arrival order, so the first contender
 * really does run first. Each contender uses its own pool with its own
 * application_name so the wait check can't be confused by other tests.
 */
const url = process.env.TEST_DATABASE_URL;
const pools: Pool[] = [];
function namedDb(applicationName: string) {
  const pool = new Pool({ connectionString: url, application_name: applicationName });
  pools.push(pool);
  return drizzle(pool, { schema });
}

const runId = randomUUID().slice(0, 8);
const main = url ? namedDb(`print-cancel-main-${runId}`) : null;
const cancelDb = url ? namedDb(`print-cancel-cancel-${runId}`) : null;
const printDb = url ? namedDb(`print-cancel-print-${runId}`) : null;
afterAll(async () => Promise.all(pools.map((p) => p.end())));

const originalProvider = process.env.PRINT_PROVIDER;
beforeEach(() => {
  process.env.PRINT_PROVIDER = "device";
});
afterEach(() => {
  if (originalProvider === undefined) delete process.env.PRINT_PROVIDER;
  else process.env.PRINT_PROVIDER = originalProvider;
});

const POS = { deviceCapable: true } as const;

async function submittedOrder() {
  const fixture = await seedTestFixture(main!, { openingStock: "1000" });
  const actor = { businessId: fixture.business.id, userId: fixture.user.id };
  const { order } = await submitOrder(main!, actor, {
    idempotencyKey: randomUUID(),
    orderType: "dine_in",
    discountTotal: 0,
    lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 2, modifierOptionIds: [] }],
  });
  const [checkoutJob] = await main!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, order.id));
  return { ...fixture, actor, order, checkoutJob };
}

/** Holds the order row lock until `release()`, from its own connection. */
async function gateOrder(orderId: string) {
  const client = await (pools[0] as Pool).connect();
  await client.query("begin");
  await client.query("select id from orders where id = $1 for update", [orderId]);
  return {
    release: async () => {
      await client.query("commit");
      client.release();
    },
  };
}

/** Resolves once a backend from `db`'s pool is waiting on a lock. */
async function blockedOnLock(db: NonNullable<typeof cancelDb>) {
  const name = (db.$client as Pool).options.application_name!;
  await vi.waitFor(
    async () => {
      const { rows } = await main!.$client.query(
        "select count(*)::int as n from pg_stat_activity where application_name = $1 and wait_event_type = 'Lock'",
        [name],
      );
      expect(rows[0].n).toBeGreaterThan(0);
    },
    { timeout: 10_000, interval: 20 },
  );
}

/** Runs `first` then `second` against the gated order, in that lock order. */
async function race<A, B>(orderId: string, first: [NonNullable<typeof cancelDb>, () => Promise<A>], second: [NonNullable<typeof cancelDb>, () => Promise<B>]) {
  const gate = await gateOrder(orderId);
  const a = first[1]().then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  await blockedOnLock(first[0]);
  const b = second[1]().then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  await blockedOnLock(second[0]);
  await gate.release();
  return Promise.all([a, b]);
}

async function stockOf(ingredientId: string) {
  const [row] = await main!.select().from(schema.ingredients).where(eq(schema.ingredients.id, ingredientId));
  return Number(row.currentQuantityBaseUnits);
}

async function movements(orderId: string, types: Array<(typeof schema.inventoryMovements.movementType.enumValues)[number]>) {
  return main!
    .select()
    .from(schema.inventoryMovements)
    .where(and(eq(schema.inventoryMovements.sourceId, orderId), inArray(schema.inventoryMovements.movementType, types)));
}

const jobsFor = (orderId: string) => main!.select().from(schema.printJobs).where(eq(schema.printJobs.orderId, orderId));
const orderStatus = async (orderId: string) => (await main!.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0].status;

describe.skipIf(!url)("cancellation vs. print authorization (PostgreSQL)", () => {
  it("refuses a reprint when cancellation takes the order lock first", async () => {
    const { actor, order, ingredient, checkoutJob } = await submittedOrder();
    const stockBeforeCancel = await stockOf(ingredient.id);

    const [cancelled, reprint] = await race(
      order.id,
      [cancelDb!, () => cancelOrder(cancelDb!, actor, order.id, "customer left")],
      [printDb!, () => createReprintJob(printDb!, actor, order.id, "tap-after-cancel", POS)],
    );

    expect(cancelled.ok).toBe(true);
    expect(reprint.ok).toBe(false);
    expect(!reprint.ok && reprint.error).toBeInstanceOf(PrintNotAllowedError);

    expect(await orderStatus(order.id)).toBe("CANCELLED");
    // No reprint job was created, and the queued checkout receipt was voided.
    const jobs = await jobsFor(order.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: checkoutJob.id, status: "CANCELLED", claimToken: null });
    expect(await stockOf(ingredient.id)).toBe(stockBeforeCancel + 40);
    expect(await movements(order.id, ["ORDER_CANCELLATION_REVERSAL"])).toHaveLength(1);
  });

  it("lets an already-authorized reprint finish when it takes the lock before cancellation", async () => {
    const { actor, order, ingredient, checkoutJob } = await submittedOrder();
    const stockBeforeCancel = await stockOf(ingredient.id);

    const [reprint, cancelled] = await race(
      order.id,
      [printDb!, () => createReprintJob(printDb!, actor, order.id, "tap-before-cancel", POS)],
      [cancelDb!, () => cancelOrder(cancelDb!, actor, order.id, "customer left")],
    );

    expect(reprint.ok && reprint.value.requiresClientAction).toBe("device_print");
    expect(cancelled.ok).toBe(true);
    expect(await orderStatus(order.id)).toBe("CANCELLED");

    const jobs = await jobsFor(order.id);
    expect(jobs).toHaveLength(2);
    // The queued checkout receipt is voided; the reprint was already handed
    // to the tablet, so it is left in flight rather than pretended revoked.
    expect(jobs.find((j) => j.id === checkoutJob.id)?.status).toBe("CANCELLED");
    const inFlight = jobs.find((j) => j.requestKey === "tap-before-cancel")!;
    expect(inFlight.status).toBe("PROCESSING");

    // The tablet's honest report still lands on that attempt...
    const token = reprint.ok ? reprint.value.attemptToken! : "";
    expect((await recordDevicePrintResult(main!, actor, inFlight.id, token, { ok: true })).status).toBe("PRINTED");
    // ...but nothing new can be authorized for the cancelled sale.
    await expect(createReprintJob(main!, actor, order.id, "tap-later", POS)).rejects.toBeInstanceOf(PrintNotAllowedError);
    await expect(retryPrintJob(main!, actor, checkoutJob.id, POS)).rejects.toBeInstanceOf(PrintNotAllowedError);

    expect(await stockOf(ingredient.id)).toBe(stockBeforeCancel + 40);
    expect(await movements(order.id, ["ORDER_CANCELLATION_REVERSAL"])).toHaveLength(1);
  });

  it("refuses retrying a FAILED job when cancellation wins", async () => {
    const { actor, order, checkoutJob } = await submittedOrder();
    await main!.update(schema.printJobs).set({ status: "FAILED", lastError: "paper out" }).where(eq(schema.printJobs.id, checkoutJob.id));

    const [cancelled, retry] = await race(
      order.id,
      [cancelDb!, () => cancelOrder(cancelDb!, actor, order.id, "void")],
      [printDb!, () => retryPrintJob(printDb!, actor, checkoutJob.id, POS)],
    );

    expect(cancelled.ok).toBe(true);
    expect(!retry.ok && retry.error).toBeInstanceOf(PrintNotAllowedError);
    const [job] = await jobsFor(order.id);
    expect(job).toMatchObject({ status: "FAILED", attemptCount: 0, claimToken: null });
  });

  it("claims the FAILED job once when the retry wins, and cancellation leaves that attempt in flight", async () => {
    const { actor, order, checkoutJob, ingredient } = await submittedOrder();
    await main!.update(schema.printJobs).set({ status: "FAILED", lastError: "paper out" }).where(eq(schema.printJobs.id, checkoutJob.id));
    const stockBeforeCancel = await stockOf(ingredient.id);

    const [retry, cancelled] = await race(
      order.id,
      [printDb!, () => retryPrintJob(printDb!, actor, checkoutJob.id, POS)],
      [cancelDb!, () => cancelOrder(cancelDb!, actor, order.id, "void")],
    );

    expect(retry.ok && retry.value.attemptToken).toBeTruthy();
    expect(cancelled.ok).toBe(true);
    expect((await jobsFor(order.id))[0]).toMatchObject({ status: "PROCESSING", attemptCount: 1 });
    expect(await stockOf(ingredient.id)).toBe(stockBeforeCancel + 40);
  });

  it("restores stock once no matter how often cancellation is repeated, even concurrently", async () => {
    const { actor, order, ingredient } = await submittedOrder();
    const stockBeforeCancel = await stockOf(ingredient.id);

    const results = await Promise.allSettled([
      cancelOrder(cancelDb!, actor, order.id, "one"),
      cancelOrder(printDb!, actor, order.id, "two"),
      cancelOrder(main!, actor, order.id, "three"),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    await cancelOrder(main!, actor, order.id, "again");

    expect(await stockOf(ingredient.id)).toBe(stockBeforeCancel + 40);
    expect(await movements(order.id, ["ORDER_CANCELLATION_REVERSAL"])).toHaveLength(1);
  });

  it("still allows a reprint of a refunded order", async () => {
    const { actor, order } = await submittedOrder();
    await refundOrder(main!, actor, order.id, "refund paperwork");
    const reprint = await createReprintJob(main!, actor, order.id, "refund-copy", POS);
    expect(reprint.requiresClientAction).toBe("device_print");
    expect(await movements(order.id, ["REFUND_REVERSAL"])).toHaveLength(1);
  });
});
