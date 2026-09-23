import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createManualAdjustment } from "@/server/services/inventory-service";
import { submitOrder } from "@/server/services/order-service";
import { createAndFinalizePurchase, getPurchaseSpend, getPaidPurchaseSpend, setPurchasePaidAt } from "@/server/services/purchase-service";
import { getExpenseSummary, listSpendingLedgerInRange } from "@/server/services/expense-service";
import { createAndSubmitStockCount } from "@/server/services/stock-count-service";
import { createWasteRecord } from "@/server/services/waste-service";
import { getTestDb, seedTestFixture, type TestDb } from "./helpers";

const db = getTestDb();

async function ingredientRow(database: TestDb, id: string) {
  const [row] = await database.select().from(schema.ingredients).where(eq(schema.ingredients.id, id));
  return row;
}

/** The ledger must always reconstruct the cached quantity (PRD rule 3). */
async function ledgerBalance(database: TestDb, ingredientId: string) {
  const [row] = await database
    .select({ total: sql<string>`coalesce(sum(${schema.inventoryMovements.quantityBaseUnits}), 0)::text` })
    .from(schema.inventoryMovements)
    .where(eq(schema.inventoryMovements.ingredientId, ingredientId));
  return Number(row.total);
}

describe.skipIf(!db)("stock flows on the batch movement path", () => {
  it("finalizes a purchase with the same ingredient on two lines, blending the average cost line by line", async () => {
    const fx = await seedTestFixture(db!, { openingStock: "100", costPerBaseUnit: "10" });
    const actor = { businessId: fx.business.id, userId: fx.user.id };

    const purchase = await createAndFinalizePurchase(db!, actor, {
      purchaseDate: "2026-09-16",
      supplierId: "",
      invoiceNumber: "INV-1",
      lines: [
        // 100 g @ Rp14/g -> 200 g @ Rp12/g (PRD §6.7 worked example)
        { ingredientId: fx.ingredient.id, quantityPurchased: 100, purchaseUnit: "g", conversionToBaseUnits: 1, unitPurchaseCost: 14 },
        // then 200 g @ Rp15/g -> 400 g @ Rp13.5/g
        { ingredientId: fx.ingredient.id, quantityPurchased: 0.2, purchaseUnit: "kg", conversionToBaseUnits: 1000, unitPurchaseCost: 15_000 },
      ],
    });

    expect(purchase.status).toBe("FINALIZED");
    expect(purchase.totalCost).toBe(1400 + 3000);
    const range = { from: "2026-09-16", to: "2026-09-16" };
    expect(await getPurchaseSpend(db!, fx.business.id, range)).toEqual({ total: 4400, count: 1 });
    expect(await getPaidPurchaseSpend(db!, fx.business.id, range)).toEqual({ total: 0, count: 0 });
    await setPurchasePaidAt(db!, actor, purchase.id, "2026-09-17");
    expect(await getPaidPurchaseSpend(db!, fx.business.id, range)).toEqual({ total: 0, count: 0 });
    expect(await getPaidPurchaseSpend(db!, fx.business.id, { from: "2026-09-17", to: "2026-09-17" })).toEqual({ total: 4400, count: 1 });
    expect((await getExpenseSummary(db!, fx.business.id, range)).total).toBe(0);
    const [electricity] = await db!.insert(schema.expenses).values({
      businessId: fx.business.id, category: "electricity", amount: 600,
      expenseDate: "2026-09-16", createdBy: fx.user.id,
    }).returning();
    const firstPage = await listSpendingLedgerInRange(db!, fx.business.id, range, { limit: 1, offset: 0 });
    const secondPage = await listSpendingLedgerInRange(db!, fx.business.id, range, { limit: 1, offset: 1 });
    expect(firstPage).toMatchObject([{ id: electricity.id, source: "expense", category: "electricity", amount: 600 }]);
    expect(secondPage).toMatchObject([{ id: purchase.id, source: "purchase", category: "Ingredient purchase", amount: 4400, paidAt: "2026-09-17" }]);
    expect((await getExpenseSummary(db!, fx.business.id, range)).total).toBe(600);

    const after = await ingredientRow(db!, fx.ingredient.id);
    expect(Number(after.currentQuantityBaseUnits)).toBe(400);
    expect(Number(after.averageCostPerBaseUnit)).toBeCloseTo(13.5, 6);
    expect(await ledgerBalance(db!, fx.ingredient.id)).toBe(300);

    const lines = await db!.select().from(schema.purchaseLines).where(eq(schema.purchaseLines.purchaseId, purchase.id));
    expect(lines).toHaveLength(2);
    const [audit] = await db!
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, purchase.id));
    expect(audit?.action).toBe("purchase.finalized");
  });

  it("submits a stock count with exact differences and no movement for a matching line", async () => {
    const fx = await seedTestFixture(db!, { openingStock: "1000" });
    const actor = { businessId: fx.business.id, userId: fx.user.id };

    const count = await createAndSubmitStockCount(db!, actor, {
      lines: [{ ingredientId: fx.ingredient.id, countedQuantity: 987.6543 }],
    });
    const lines = await db!.select().from(schema.stockCountLines).where(eq(schema.stockCountLines.stockCountId, count.id));
    expect(lines[0].differenceQuantity).toBe("-12.3457");
    expect(Number((await ingredientRow(db!, fx.ingredient.id)).currentQuantityBaseUnits)).toBe(987.6543);
    expect(await ledgerBalance(db!, fx.ingredient.id)).toBe(-12.3457);

    // Counting the same figure again changes nothing and writes no movement.
    const again = await createAndSubmitStockCount(db!, actor, {
      lines: [{ ingredientId: fx.ingredient.id, countedQuantity: 987.6543 }],
    });
    const movements = await db!
      .select()
      .from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.sourceId, again.id));
    expect(movements).toHaveLength(0);
  });

  it("records waste with a ledger row linked to the record, and refuses to go below zero", async () => {
    const fx = await seedTestFixture(db!, { openingStock: "50", costPerBaseUnit: "2.5" });
    const actor = { businessId: fx.business.id, userId: fx.user.id };

    const waste = await createWasteRecord(db!, actor, { ingredientId: fx.ingredient.id, quantityBaseUnits: 20, reason: "spilled" });
    expect(waste.estimatedCost).toBe(50);
    const [movement] = await db!
      .select()
      .from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.sourceId, waste.id));
    expect(movement.movementType).toBe("WASTE");
    expect(Number(movement.quantityBaseUnits)).toBe(-20);
    expect(Number((await ingredientRow(db!, fx.ingredient.id)).currentQuantityBaseUnits)).toBe(30);

    await expect(
      createWasteRecord(db!, actor, { ingredientId: fx.ingredient.id, quantityBaseUnits: 31, reason: "expired" }),
    ).rejects.toThrow(/Insufficient stock/);
    expect(Number((await ingredientRow(db!, fx.ingredient.id)).currentQuantityBaseUnits)).toBe(30);
  });

  it("applies manual adjustments and audits them in the same transaction", async () => {
    const fx = await seedTestFixture(db!, { openingStock: "10" });
    const actor = { businessId: fx.business.id, userId: fx.user.id };

    const movement = await createManualAdjustment(
      db!,
      actor,
      { ingredientId: fx.ingredient.id, direction: "out", quantityBaseUnits: 4, reason: "Spoiled" },
      { allowNegativeStock: false },
    );
    expect(Number((await ingredientRow(db!, fx.ingredient.id)).currentQuantityBaseUnits)).toBe(6);
    const [audit] = await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, movement.id));
    expect(audit?.action).toBe("inventory.manual_adjustment");

    await expect(
      createManualAdjustment(
        db!,
        actor,
        { ingredientId: fx.ingredient.id, direction: "out", quantityBaseUnits: 7, reason: "Too much" },
        { allowNegativeStock: false },
      ),
    ).rejects.toThrow(/Insufficient stock/);
  });

  it("records order COGS that equals the sum of its consumption rows and ledger rows", async () => {
    // 20 g/unit @ Rp0.91356/g, 3 units: 54.8136 Rp -> 55, not 3 x round(18.27) = 54.
    const fx = await seedTestFixture(db!, { openingStock: "1000", costPerBaseUnit: "0.91356" });
    const actor = { businessId: fx.business.id, userId: fx.user.id };

    const { order } = await submitOrder(db!, actor, {
      idempotencyKey: `cogs-${fx.business.id}`,
      orderType: "takeaway",
      discountTotal: 0,
      lines: [{ menuItemId: fx.menuItem.id, menuItemVariantId: fx.variant.id, quantity: 3, modifierOptionIds: [] }],
    });

    expect(order.cogsTotal).toBe(55);
    const consumption = await db!
      .select()
      .from(schema.orderIngredientConsumption)
      .where(eq(schema.orderIngredientConsumption.orderId, order.id));
    expect(consumption.reduce((sum, row) => sum + row.totalCost, 0)).toBe(order.cogsTotal);
    const movements = await db!
      .select()
      .from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.sourceId, order.id));
    expect(movements.reduce((sum, row) => sum + (row.totalCost ?? 0), 0)).toBe(order.cogsTotal);
  });
});
