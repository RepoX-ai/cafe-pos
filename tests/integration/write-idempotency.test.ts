import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTestDb, seedTestFixture } from "./helpers";
import { LockHolder, track } from "./concurrency-helpers";
import { createAndFinalizePurchase } from "@/server/services/purchase-service";
import { createWasteRecord } from "@/server/services/waste-service";
import { createManualAdjustment } from "@/server/services/inventory-service";
import { createAndSubmitStockCount } from "@/server/services/stock-count-service";
import { createExpense } from "@/server/services/expense-service";
import { IdempotencyMismatchError } from "@/server/services/errors";
import { submitOrderForUser } from "@/server/services/checkout";

const dbA = getTestDb();
const dbB = getTestDb();
const holderDb = getTestDb();
afterAll(async () => {
  await Promise.all([dbA?.$client.end(), dbB?.$client.end(), holderDb?.$client.end()]);
});

const key = () => randomUUID();

async function stock(ingredientId: string) {
  const [row] = await dbA!.select().from(schema.ingredients).where(eq(schema.ingredients.id, ingredientId));
  return { quantity: Number(row.currentQuantityBaseUnits), cost: row.averageCostPerBaseUnit };
}

function purchaseInput(ingredientId: string, idempotencyKey?: string, unitPurchaseCost = 90_000) {
  return {
    idempotencyKey,
    purchaseDate: "2026-09-01",
    lines: [{ ingredientId, quantityPurchased: 2, purchaseUnit: "kg", conversionToBaseUnits: 1000, unitPurchaseCost }],
  };
}

describe.skipIf(!dbA)("idempotent back-office writes (PostgreSQL)", () => {
  it("records a retried purchase receipt once — stock and average cost move once", async () => {
    const f = await seedTestFixture(dbA!, { openingStock: "1000", costPerBaseUnit: "50" });
    const actor = { businessId: f.business.id, userId: f.user.id };
    const k = key();

    const first = await createAndFinalizePurchase(dbA!, actor, purchaseInput(f.ingredient.id, k));
    const afterFirst = await stock(f.ingredient.id);
    const retry = await createAndFinalizePurchase(dbB!, actor, purchaseInput(f.ingredient.id, k));

    expect(retry.id).toBe(first.id);
    expect(await stock(f.ingredient.id)).toEqual(afterFirst);
    expect(afterFirst.quantity).toBe(3000);
    expect(await dbA!.$count(schema.purchases, eq(schema.purchases.businessId, f.business.id))).toBe(1);
    expect(await dbA!.$count(schema.inventoryMovements, eq(schema.inventoryMovements.sourceId, first.id))).toBe(1);
  });

  it("records a concurrent duplicate purchase once, the loser returning the winner's receipt", async () => {
    const f = await seedTestFixture(dbA!, { openingStock: "1000", costPerBaseUnit: "50" });
    const actor = { businessId: f.business.id, userId: f.user.id };
    const k = key();

    // Hold the ingredient: the first submission claims the key and waits on
    // the ingredient lock; the duplicate then waits on the key.
    const holder = await LockHolder.begin(holderDb!.$client);
    await holder.query("select id from ingredients where id = $1 for update", [f.ingredient.id]);
    const one = track(createAndFinalizePurchase(dbA!, actor, purchaseInput(f.ingredient.id, k)));
    await holder.waitForBlocked(1);
    const two = track(createAndFinalizePurchase(dbB!, actor, purchaseInput(f.ingredient.id, k)));
    await holder.waitForBlocked(2);
    await holder.commit();

    const [a, b] = await Promise.all([one.promise, two.promise]);
    expect(a.id).toBe(b.id);
    expect((await stock(f.ingredient.id)).quantity).toBe(3000);
    expect(await dbA!.$count(schema.purchases, eq(schema.purchases.businessId, f.business.id))).toBe(1);
  });

  it("refuses a key reused for a different payload, and keys are per business and per operation", async () => {
    const a = await seedTestFixture(dbA!);
    const b = await seedTestFixture(dbA!);
    const actorA = { businessId: a.business.id, userId: a.user.id };
    const actorB = { businessId: b.business.id, userId: b.user.id };
    const k = key();

    await createAndFinalizePurchase(dbA!, actorA, purchaseInput(a.ingredient.id, k, 90_000));
    await expect(createAndFinalizePurchase(dbA!, actorA, purchaseInput(a.ingredient.id, k, 95_000))).rejects.toBeInstanceOf(IdempotencyMismatchError);
    // Same key string in another café, or for another kind of write: independent.
    await expect(createAndFinalizePurchase(dbA!, actorB, purchaseInput(b.ingredient.id, k))).resolves.toBeDefined();
    await expect(createWasteRecord(dbA!, actorA, { ingredientId: a.ingredient.id, quantityBaseUnits: 5, reason: "spilled", idempotencyKey: k })).resolves.toBeDefined();
  });

  it("dedupes waste, adjustments, stock counts and expenses on retry", async () => {
    const f = await seedTestFixture(dbA!, { openingStock: "1000" });
    const actor = { businessId: f.business.id, userId: f.user.id };

    const wasteKey = key();
    const w1 = await createWasteRecord(dbA!, actor, { ingredientId: f.ingredient.id, quantityBaseUnits: 10, reason: "spilled", idempotencyKey: wasteKey });
    const w2 = await createWasteRecord(dbB!, actor, { ingredientId: f.ingredient.id, quantityBaseUnits: 10, reason: "spilled", idempotencyKey: wasteKey });
    expect(w2.id).toBe(w1.id);

    const adjustKey = key();
    const adj = { ingredientId: f.ingredient.id, direction: "in" as const, quantityBaseUnits: 5, reason: "found", idempotencyKey: adjustKey };
    const a1 = await createManualAdjustment(dbA!, actor, adj, { allowNegativeStock: false });
    const a2 = await createManualAdjustment(dbB!, actor, adj, { allowNegativeStock: false });
    expect(a2.id).toBe(a1.id);

    const countKey = key();
    const c1 = await createAndSubmitStockCount(dbA!, actor, { lines: [{ ingredientId: f.ingredient.id, countedQuantity: 900 }], idempotencyKey: countKey });
    const c2 = await createAndSubmitStockCount(dbB!, actor, { lines: [{ ingredientId: f.ingredient.id, countedQuantity: 900 }], idempotencyKey: countKey });
    expect(c2.id).toBe(c1.id);

    const expenseKey = key();
    const expense = { category: "rent" as const, amount: 1_000_000, expenseDate: "2026-09-01", idempotencyKey: expenseKey };
    const e1 = await createExpense(dbA!, actor, expense);
    const e2 = await createExpense(dbB!, actor, expense);
    expect(e2.id).toBe(e1.id);

    // 1000 - 10 waste + 5 adjustment, then counted to 900: each applied once.
    expect((await stock(f.ingredient.id)).quantity).toBe(900);
    expect(await dbA!.$count(schema.wasteRecords, eq(schema.wasteRecords.businessId, f.business.id))).toBe(1);
    expect(await dbA!.$count(schema.stockCounts, eq(schema.stockCounts.businessId, f.business.id))).toBe(1);
    expect(await dbA!.$count(schema.expenses, eq(schema.expenses.businessId, f.business.id))).toBe(1);
    expect(
      await dbA!.$count(schema.inventoryMovements, and(eq(schema.inventoryMovements.businessId, f.business.id), eq(schema.inventoryMovements.movementType, "MANUAL_ADJUSTMENT_IN"))),
    ).toBe(1);
  });

  it("keeps the old behaviour when a client sends no key", async () => {
    const f = await seedTestFixture(dbA!, { openingStock: "1000" });
    const actor = { businessId: f.business.id, userId: f.user.id };
    await createWasteRecord(dbA!, actor, { ingredientId: f.ingredient.id, quantityBaseUnits: 10, reason: "spilled" });
    await createWasteRecord(dbA!, actor, { ingredientId: f.ingredient.id, quantityBaseUnits: 10, reason: "spilled" });
    expect(await dbA!.$count(schema.wasteRecords, eq(schema.wasteRecords.businessId, f.business.id))).toBe(2);
  });
});

describe.skipIf(!dbA)("bounded checkout retries (PostgreSQL)", () => {
  it("always returns the original order to a retry, and stops re-claiming the print job past the retry quota", async () => {
    const f = await seedTestFixture(dbA!, { openingStock: "1000" });
    const user = { id: f.user.id, businessId: f.business.id, roles: ["cashier" as const] };
    const input = {
      idempotencyKey: key(),
      orderType: "dine_in",
      lines: [{ menuItemId: f.menuItem.id, menuItemVariantId: f.variant.id, quantity: 1, modifierOptionIds: [] }],
    };
    const retryRule = { name: `retry-${randomUUID()}`, limit: 2, windowSeconds: 60 };

    const first = await submitOrderForUser(dbA!, user, input, { retryRule });
    expect(first.ok).toBe(true);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await submitOrderForUser(dbA!, user, input, { retryRule }));

    for (const r of results) expect(r).toMatchObject({ ok: true, idempotent: true, orderId: first.ok ? first.orderId : "" });
    expect(await dbA!.$count(schema.orders, eq(schema.orders.businessId, f.business.id))).toBe(1);
    expect((await stock(f.ingredient.id)).quantity).toBe(980);
  });
});
