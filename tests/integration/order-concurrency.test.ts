import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTestDb, seedTestFixture, type TestDb } from "./helpers";
import { cancelOrder, OrderValidationError, refundOrder, submitOrder } from "@/server/services/order-service";
import { InsufficientStockError } from "@/server/services/inventory-service";

// Two independent pools, so racing calls really run on separate PostgreSQL
// connections (and separate transactions), not one serialized client.
const dbA = getTestDb();
const dbB = getTestDb();

afterAll(async () => {
  await Promise.all([dbA?.$client.end(), dbB?.$client.end()]);
});

function alternate<T>(count: number, run: (db: TestDb, i: number) => Promise<T>) {
  return Promise.allSettled(Array.from({ length: count }, (_, i) => run(i % 2 === 0 ? dbA! : dbB!, i)));
}

async function stockOf(ingredientId: string) {
  const [row] = await dbA!.select().from(schema.ingredients).where(eq(schema.ingredients.id, ingredientId));
  return Number(row.currentQuantityBaseUnits);
}

async function movementsFor(orderId: string, types: Array<(typeof schema.inventoryMovements.movementType.enumValues)[number]>) {
  return dbA!
    .select()
    .from(schema.inventoryMovements)
    .where(and(eq(schema.inventoryMovements.sourceId, orderId), inArray(schema.inventoryMovements.movementType, types)));
}

async function submittedOrder(quantity = 3) {
  const fixture = await seedTestFixture(dbA!, { openingStock: "1000" });
  const actor = { businessId: fixture.business.id, userId: fixture.user.id };
  const { order } = await submitOrder(dbA!, actor, {
    idempotencyKey: randomUUID(),
    orderType: "dine_in",
    discountTotal: 0,
    lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity, modifierOptionIds: [] }],
  });
  return { ...fixture, actor, order };
}

describe.skipIf(!dbA)("order reversal concurrency (PostgreSQL)", () => {
  it("restores stock exactly once when the same order is cancelled concurrently", async () => {
    const { actor, order, ingredient } = await submittedOrder();
    expect(await stockOf(ingredient.id)).toBe(940);

    const results = await alternate(8, (db) => cancelOrder(db, actor, order.id, "race"));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await stockOf(ingredient.id)).toBe(1000);
    expect(await movementsFor(order.id, ["ORDER_CANCELLATION_REVERSAL"])).toHaveLength(1);
    const [saved] = await dbA!.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(saved.status).toBe("CANCELLED");
  });

  it("restores stock exactly once when the same order is refunded concurrently", async () => {
    const { actor, order, ingredient } = await submittedOrder();

    const results = await alternate(8, (db) => refundOrder(db, actor, order.id, "race"));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await stockOf(ingredient.id)).toBe(1000);
    expect(await movementsFor(order.id, ["REFUND_REVERSAL"])).toHaveLength(1);
    const [saved] = await dbA!.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(saved.status).toBe("REFUNDED");
  });

  it("lets only one of a competing cancellation and refund reverse stock", async () => {
    const { actor, order, ingredient } = await submittedOrder();

    const results = await alternate(8, (db, i) =>
      i % 2 === 0 ? cancelOrder(db, actor, order.id, "race") : refundOrder(db, actor, order.id, "race"),
    );

    const rejected = results.filter((r) => r.status === "rejected");
    for (const r of rejected) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(OrderValidationError);
    const [saved] = await dbA!.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(["CANCELLED", "REFUNDED"]).toContain(saved.status);
    // Every call for the winning status is an idempotent success; every call for the other is refused.
    const winnerIsCancel = saved.status === "CANCELLED";
    results.forEach((r, i) => expect(r.status).toBe((i % 2 === 0) === winnerIsCancel ? "fulfilled" : "rejected"));
    expect(await movementsFor(order.id, ["ORDER_CANCELLATION_REVERSAL", "REFUND_REVERSAL"])).toHaveLength(1);
    expect(await stockOf(ingredient.id)).toBe(1000);
  });

  it("keeps sequential duplicate refunds idempotent", async () => {
    const { actor, order, ingredient } = await submittedOrder();
    await refundOrder(dbA!, actor, order.id, "first");
    await refundOrder(dbB!, actor, order.id, "second");
    await expect(cancelOrder(dbA!, actor, order.id, "late")).rejects.toThrow(OrderValidationError);
    expect(await stockOf(ingredient.id)).toBe(1000);
    expect(await movementsFor(order.id, ["ORDER_CANCELLATION_REVERSAL", "REFUND_REVERSAL"])).toHaveLength(1);
  });

  it("rolls back every reversal when any part of the cancellation fails", async () => {
    const fixture = await seedTestFixture(dbA!, { openingStock: "1000" });
    const actor = { businessId: fixture.business.id, userId: fixture.user.id };
    const [second] = await dbA!
      .insert(schema.ingredients)
      .values({ businessId: fixture.business.id, name: `Milk ${randomUUID()}`, baseUnit: "millilitre", currentQuantityBaseUnits: "1000", averageCostPerBaseUnit: "1" })
      .returning();
    const [recipe] = await dbA!.select().from(schema.recipes).where(eq(schema.recipes.menuItemVariantId, fixture.variant.id));
    await dbA!.insert(schema.recipeLines).values({ recipeId: recipe.id, ingredientId: second.id, quantityBaseUnits: "50" });
    const { order } = await submitOrder(dbA!, actor, {
      idempotencyKey: randomUUID(),
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 2, modifierOptionIds: [] }],
    });
    // Moving one consumed ingredient out of this business makes it
    // unreachable, so the reversal must fail — and must leave nothing behind.
    const other = await seedTestFixture(dbA!);
    await dbA!.update(schema.ingredients).set({ businessId: other.business.id }).where(eq(schema.ingredients.id, second.id));

    await expect(cancelOrder(dbA!, actor, order.id, "fails")).rejects.toThrow();

    expect(await stockOf(fixture.ingredient.id)).toBe(960);
    expect(await stockOf(second.id)).toBe(900);
    expect(await movementsFor(order.id, ["ORDER_CANCELLATION_REVERSAL"])).toHaveLength(0);
    const [saved] = await dbA!.select().from(schema.orders).where(eq(schema.orders.id, order.id));
    expect(saved.status).toBe("SUBMITTED");
  });
});

describe.skipIf(!dbA)("order submission concurrency (PostgreSQL)", () => {
  it("gives concurrent distinct submissions unique sequential numbers and correct stock", async () => {
    const fixture = await seedTestFixture(dbA!, { openingStock: "1000" });
    const actor = { businessId: fixture.business.id, userId: fixture.user.id };

    const results = await alternate(10, (db) =>
      submitOrder(db, actor, {
        idempotencyKey: randomUUID(),
        orderType: "takeaway",
        discountTotal: 0,
        lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 1, modifierOptionIds: [] }],
      }),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const numbers = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof submitOrder>>>).value.order.orderNumber).sort();
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => `TST-${String(i + 1).padStart(5, "0")}`));
    expect(await stockOf(fixture.ingredient.id)).toBe(1000 - 10 * 20);
    const movements = await dbA!.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.ingredientId, fixture.ingredient.id));
    expect(movements.filter((m) => m.movementType === "SALE_CONSUMPTION")).toHaveLength(10);
  });

  it("creates one order and one set of movements for concurrent retries of the same key", async () => {
    const fixture = await seedTestFixture(dbA!, { openingStock: "1000" });
    const actor = { businessId: fixture.business.id, userId: fixture.user.id };
    const input = {
      idempotencyKey: randomUUID(),
      orderType: "dine_in" as const,
      discountTotal: 0,
      lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 2, modifierOptionIds: [] }],
    };

    const results = await alternate(8, (db) => submitOrder(db, actor, input));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const values = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof submitOrder>>>).value);
    expect(new Set(values.map((v) => v.order.id)).size).toBe(1);
    expect(values.filter((v) => !v.idempotent)).toHaveLength(1);
    const orders = await dbA!.select().from(schema.orders).where(eq(schema.orders.businessId, fixture.business.id));
    expect(orders).toHaveLength(1);
    expect(await stockOf(fixture.ingredient.id)).toBe(960);
    expect(await movementsFor(orders[0].id, ["SALE_CONSUMPTION"])).toHaveLength(1);
  });

  it("never oversells when concurrent orders compete for the last stock", async () => {
    const fixture = await seedTestFixture(dbA!, { openingStock: "60" }); // enough for exactly 3 units
    const actor = { businessId: fixture.business.id, userId: fixture.user.id };

    const results = await alternate(6, (db) =>
      submitOrder(db, actor, {
        idempotencyKey: randomUUID(),
        orderType: "dine_in",
        discountTotal: 0,
        lines: [{ menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 1, modifierOptionIds: [] }],
      }),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientStockError);
    }
    expect(await stockOf(fixture.ingredient.id)).toBe(0);
  });

  it("merges ingredient demand across lines that share ingredients and modifiers", async () => {
    const fixture = await seedTestFixture(dbA!, { openingStock: "10000", costPerBaseUnit: "10" });
    const actor = { businessId: fixture.business.id, userId: fixture.user.id };
    const suffix = randomUUID().slice(0, 8);
    const [beans] = await dbA!
      .insert(schema.ingredients)
      .values({ businessId: fixture.business.id, name: `Sugar ${suffix}`, baseUnit: "gram", currentQuantityBaseUnits: "500", averageCostPerBaseUnit: "4" })
      .returning();
    const [recipe] = await dbA!.select().from(schema.recipes).where(eq(schema.recipes.menuItemVariantId, fixture.variant.id));
    await dbA!.insert(schema.recipeLines).values({ recipeId: recipe.id, ingredientId: beans.id, quantityBaseUnits: "5" });

    const [tea] = await dbA!.insert(schema.menuItems).values({ businessId: fixture.business.id, name: `Tea ${suffix}`, basePrice: 15_000 }).returning();
    const [teaVariant] = await dbA!.insert(schema.menuItemVariants).values({ menuItemId: tea.id, name: "Regular", price: 15_000 }).returning();
    const [teaRecipe] = await dbA!.insert(schema.recipes).values({ menuItemVariantId: teaVariant.id }).returning();
    await dbA!.insert(schema.recipeLines).values({ recipeId: teaRecipe.id, ingredientId: fixture.ingredient.id, quantityBaseUnits: "10" });

    const [group] = await dbA!.insert(schema.modifierGroups).values({ businessId: fixture.business.id, name: "Extra", maxSelections: 1 }).returning();
    const [extra] = await dbA!.insert(schema.modifierOptions).values({ modifierGroupId: group.id, name: "Extra shot", priceAdjustment: 3_000 }).returning();
    await dbA!.insert(schema.modifierRecipeLines).values({ modifierOptionId: extra.id, ingredientId: fixture.ingredient.id, quantityBaseUnits: "7" });
    await dbA!.insert(schema.menuItemModifierGroups).values([
      { menuItemId: fixture.menuItem.id, modifierGroupId: group.id },
      { menuItemId: tea.id, modifierGroupId: group.id },
    ]);

    const { order } = await submitOrder(dbA!, actor, {
      idempotencyKey: randomUUID(),
      orderType: "dine_in",
      discountTotal: 0,
      lines: [
        { menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 2, modifierOptionIds: [extra.id] },
        { menuItemId: tea.id, menuItemVariantId: teaVariant.id, quantity: 3, modifierOptionIds: [extra.id] },
        { menuItemId: fixture.menuItem.id, menuItemVariantId: fixture.variant.id, quantity: 1, modifierOptionIds: [] },
      ],
    });

    // Coffee (20g bean + 5g sugar) + shot (7g bean); tea 10g bean + shot.
    expect(await stockOf(fixture.ingredient.id)).toBe(10000 - (27 * 2 + 17 * 3 + 20));
    expect(await stockOf(beans.id)).toBe(500 - 15);
    expect(order.subtotal).toBe(23_000 * 2 + 18_000 * 3 + 20_000);
    expect(order.cogsTotal).toBe(290 * 2 + 170 * 3 + 220);
    const consumption = await dbA!.select().from(schema.orderIngredientConsumption).where(eq(schema.orderIngredientConsumption.orderId, order.id));
    expect(consumption).toHaveLength(5);
    const movements = await movementsFor(order.id, ["SALE_CONSUMPTION"]);
    expect(movements).toHaveLength(5);
    expect(new Set(consumption.map((c) => c.inventoryMovementId))).toEqual(new Set(movements.map((m) => m.id)));
  });
});
