import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  ingredients,
  inventoryMovements,
  orderIngredientConsumption,
  orders,
  recipeLines,
  recipes,
  wasteRecords,
} from "@/lib/db/schema";
import { getTestDb, seedTestFixture } from "./helpers";
import { deleteIngredient, getRecipeUsageByIngredient } from "@/server/services/ingredient-service";
import { createWasteRecord } from "@/server/services/waste-service";
import { listMovements } from "@/server/services/inventory-service";
import { cancelOrder, refundOrder, submitOrder } from "@/server/services/order-service";

const db = getTestDb();

describe.skipIf(!db)("deleting an ingredient keeps stock and cost history readable (integration)", () => {
  it("detaches the ledger and COGS trail instead of destroying them", async () => {
    const { business, user, ingredient, variant, menuItem } = await seedTestFixture(db!, {
      openingStock: "1000",
      costPerBaseUnit: "10",
    });
    const actor = { businessId: business.id, userId: user.id };

    const submitted = await submitOrder(db!, actor, {
      idempotencyKey: `ing-del-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 2, modifierOptionIds: [] }],
    });
    await createWasteRecord(db!, actor, {
      ingredientId: ingredient.id,
      quantityBaseUnits: 5,
      reason: "spilled",
    });

    const movementsBefore = await listMovements(db!, business.id, { ingredientId: ingredient.id });
    expect(movementsBefore.length).toBeGreaterThan(0);
    const [consumptionBefore] = await db!
      .select()
      .from(orderIngredientConsumption)
      .where(eq(orderIngredientConsumption.orderId, submitted.order.id));

    await deleteIngredient(db!, actor, ingredient.id);

    // The ledger rows survive, detached, and still say what they were about.
    const movementsAfter = await db!
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.businessId, business.id));
    expect(movementsAfter.length).toBe(movementsBefore.length);
    for (const m of movementsAfter) {
      expect(m.ingredientId).toBeNull();
      expect(m.ingredientNameSnapshot).toBe(ingredient.name);
      expect(m.ingredientBaseUnitSnapshot).toBe("gram");
    }

    // The COGS audit row survives with its numbers untouched.
    const [consumptionAfter] = await db!
      .select()
      .from(orderIngredientConsumption)
      .where(eq(orderIngredientConsumption.orderId, submitted.order.id));
    expect(consumptionAfter.ingredientId).toBeNull();
    expect(consumptionAfter.ingredientNameSnapshot).toBe(ingredient.name);
    expect(consumptionAfter.totalCost).toBe(consumptionBefore.totalCost);
    expect(consumptionAfter.quantityBaseUnits).toBe(consumptionBefore.quantityBaseUnits);

    // And the waste record still names the ingredient it was about.
    const [waste] = await db!
      .select()
      .from(wasteRecords)
      .where(eq(wasteRecords.businessId, business.id));
    expect(waste.ingredientId).toBeNull();
    expect(waste.ingredientNameSnapshot).toBe(ingredient.name);
  });

  it("still renders the movement ledger after the ingredient is gone", async () => {
    const { business, user, ingredient } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };
    await createWasteRecord(db!, actor, {
      ingredientId: ingredient.id,
      quantityBaseUnits: 5,
      reason: "spilled",
    });

    await deleteIngredient(db!, actor, ingredient.id);

    const rows = await listMovements(db!, business.id);
    expect(rows.length).toBeGreaterThan(0);
    // The read falls back to the snapshot rather than dropping the row.
    expect(rows.every((r) => r.ingredientName === ingredient.name)).toBe(true);
    expect(rows.every((r) => r.baseUnit === "gram")).toBe(true);
  });

  it("does not change a past order's recorded COGS or profit", async () => {
    const { business, user, ingredient, variant, menuItem } = await seedTestFixture(db!, {
      openingStock: "1000",
      costPerBaseUnit: "10",
    });
    const actor = { businessId: business.id, userId: user.id };
    const submitted = await submitOrder(db!, actor, {
      idempotencyKey: `ing-cogs-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 2, modifierOptionIds: [] }],
    });

    await deleteIngredient(db!, actor, ingredient.id);

    const [after] = await db!.select().from(orders).where(eq(orders.id, submitted.order.id));
    expect(after.cogsTotal).toBe(submitted.order.cogsTotal);
    expect(after.grossProfit).toBe(submitted.order.grossProfit);
    expect(after.total).toBe(submitted.order.total);
  });

  it("drops the ingredient out of the recipes that used it", async () => {
    const { business, user, ingredient, variant } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };

    const usageBefore = await getRecipeUsageByIngredient(db!, business.id);
    expect(usageBefore[ingredient.id]).toBe(1);

    await deleteIngredient(db!, actor, ingredient.id);

    const linesAfter = await db!
      .select()
      .from(recipeLines)
      .where(eq(recipeLines.ingredientId, ingredient.id));
    expect(linesAfter).toHaveLength(0);
    // The recipe itself survives — it just has one fewer line.
    const remaining = await db!.select().from(recipes).where(eq(recipes.menuItemVariantId, variant.id));
    expect(remaining).toHaveLength(1);
  });

  it("can still cancel an order whose ingredient was deleted", async () => {
    const { business, user, ingredient, variant, menuItem } = await seedTestFixture(db!, {
      openingStock: "1000",
      costPerBaseUnit: "10",
    });
    const actor = { businessId: business.id, userId: user.id };
    const submitted = await submitOrder(db!, actor, {
      idempotencyKey: `ing-cancel-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    await deleteIngredient(db!, actor, ingredient.id);

    // There is no stock left to hand back, but cancelling must not blow up.
    const cancelled = await cancelOrder(db!, actor, submitted.order.id, "Customer changed mind");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("can still refund an order whose ingredient was deleted", async () => {
    const { business, user, ingredient, variant, menuItem } = await seedTestFixture(db!, {
      openingStock: "1000",
      costPerBaseUnit: "10",
    });
    const actor = { businessId: business.id, userId: user.id };
    const submitted = await submitOrder(db!, actor, {
      idempotencyKey: `ing-refund-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    await deleteIngredient(db!, actor, ingredient.id);

    // Refund walks the same consumption rows as cancellation.
    const refunded = await refundOrder(db!, actor, submitted.order.id, "Wrong order");
    expect(refunded.status).toBe("REFUNDED");
  });

  it("still restores stock for the ingredients that remain", async () => {
    const { business, user, ingredient, variant, menuItem } = await seedTestFixture(db!, {
      openingStock: "1000",
      costPerBaseUnit: "10",
    });
    const actor = { businessId: business.id, userId: user.id };
    const submitted = await submitOrder(db!, actor, {
      idempotencyKey: `ing-restore-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 2, modifierOptionIds: [] }],
    });

    // 2 units x 20g = 40g consumed, leaving 960g.
    const [afterSale] = await db!.select().from(ingredients).where(eq(ingredients.id, ingredient.id));
    expect(Number(afterSale.currentQuantityBaseUnits)).toBe(960);

    // No ingredient deleted here: the skip must not swallow a real reversal.
    await cancelOrder(db!, actor, submitted.order.id, "Customer changed mind");

    const [afterCancel] = await db!.select().from(ingredients).where(eq(ingredients.id, ingredient.id));
    expect(Number(afterCancel.currentQuantityBaseUnits)).toBe(1000);
  });

  it("scopes deletes to the caller's business", async () => {
    const { ingredient } = await seedTestFixture(db!);
    const other = await seedTestFixture(db!);

    await expect(
      deleteIngredient(db!, { businessId: other.business.id, userId: other.user.id }, ingredient.id),
    ).rejects.toThrow(/not found/i);
  });
});
