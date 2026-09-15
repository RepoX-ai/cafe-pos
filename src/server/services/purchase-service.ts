import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ingredients, purchaseLines, purchases, suppliers } from "@/lib/db/schema";
import { convertToBaseUnits } from "@/lib/units/units";
import { microsToRupiah, multiplyQuantityByRate } from "@/lib/money/money";
import { calculateWeightedAverageCost } from "@/lib/purchasing/weighted-average-cost";
import type { PurchaseInput } from "@/lib/validation/purchase";
import type { BusinessDateRange } from "@/lib/dates/dates";
import { withinCalendarDates } from "./range-filters";
import { recordAuditLog } from "./audit";
import { insertMovementAndApplyStock, lockIngredientForUpdate, lockIngredientsForUpdate } from "./inventory-service";
import type { ActorContext } from "./ingredient-service";

/** Newest receipts first; `range` filters on the date-only purchase_date. */
export async function listPurchases(
  db: Database,
  businessId: string,
  opts: { range?: BusinessDateRange; limit: number; offset: number },
) {
  const conditions = [eq(purchases.businessId, businessId)];
  if (opts.range) conditions.push(withinCalendarDates(purchases.purchaseDate, opts.range));
  return db
    .select({
      id: purchases.id,
      invoiceNumber: purchases.invoiceNumber,
      purchaseDate: purchases.purchaseDate,
      status: purchases.status,
      totalCost: purchases.totalCost,
      createdAt: purchases.createdAt,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .limit(opts.limit)
    .offset(opts.offset);
}

export async function getPurchaseWithLines(db: Database, businessId: string, id: string) {
  const [purchase] = await db
    .select({
      id: purchases.id,
      invoiceNumber: purchases.invoiceNumber,
      purchaseDate: purchases.purchaseDate,
      status: purchases.status,
      totalCost: purchases.totalCost,
      createdAt: purchases.createdAt,
      finalizedAt: purchases.finalizedAt,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(and(eq(purchases.id, id), eq(purchases.businessId, businessId)))
    .limit(1);
  if (!purchase) return null;

  const lines = await db
    .select({
      id: purchaseLines.id,
      ingredientId: purchaseLines.ingredientId,
      ingredientName: sql<string>`coalesce(${ingredients.name}, ${purchaseLines.ingredientNameSnapshot}, 'Deleted ingredient')`,
      ingredientBaseUnit: sql<"gram" | "millilitre" | "piece">`coalesce(${ingredients.baseUnit}, ${purchaseLines.ingredientBaseUnitSnapshot}, 'gram')`,
      quantityPurchased: purchaseLines.quantityPurchased,
      purchaseUnit: purchaseLines.purchaseUnit,
      conversionToBaseUnits: purchaseLines.conversionToBaseUnits,
      quantityBaseUnits: purchaseLines.quantityBaseUnits,
      totalLineCost: purchaseLines.totalLineCost,
      costPerBaseUnit: purchaseLines.costPerBaseUnit,
    })
    .from(purchaseLines)
    .leftJoin(ingredients, eq(purchaseLines.ingredientId, ingredients.id))
    .where(eq(purchaseLines.purchaseId, id));

  return { purchase, lines };
}

/**
 * Creates and immediately finalizes a purchase receipt in one transaction:
 * increases stock, recomputes each ingredient's weighted average cost, and
 * writes a PURCHASE_RECEIPT movement per line (PRD §6.7). The `status`/
 * `finalizedAt` columns exist so a future draft-then-finalize workflow can
 * be layered on without a schema change, but the MVP only ever creates
 * receipts pre-finalized — once finalized, a purchase is immutable; fix
 * mistakes with a new reversing entry, not an edit.
 */
export async function createAndFinalizePurchase(
  db: Database,
  actor: ActorContext,
  input: PurchaseInput & { locationId?: string | null },
) {
  const purchase = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(purchases)
      .values({
        businessId: actor.businessId,
        locationId: input.locationId ?? null,
        supplierId: input.supplierId || null,
        invoiceNumber: input.invoiceNumber || null,
        purchaseDate: input.purchaseDate,
        status: "DRAFT",
        createdBy: actor.userId,
      })
      .returning();

    let totalCost = 0;

    // Take every ingredient lock up front, in id order, like checkout and
    // order reversals do — per-line locking in entry order could deadlock
    // against them.
    await lockIngredientsForUpdate(tx, actor.businessId, input.lines.map((line) => line.ingredientId));

    for (const line of input.lines) {
      const quantityBaseUnits = convertToBaseUnits({
        quantityPurchased: line.quantityPurchased,
        conversionToBaseUnits: line.conversionToBaseUnits,
      });
      const totalLineCost = microsToRupiah(
        multiplyQuantityByRate(line.quantityPurchased, line.unitPurchaseCost),
      );
      const costPerBaseUnit = totalLineCost / quantityBaseUnits;
      totalCost += totalLineCost;

      const locked = await lockIngredientForUpdate(tx, actor.businessId, line.ingredientId);
      const newAverageCost = calculateWeightedAverageCost({
        existingQuantity: Number(locked.currentQuantityBaseUnits),
        existingAverageCost: Number(locked.averageCostPerBaseUnit),
        incomingQuantity: quantityBaseUnits,
        incomingCostPerUnit: costPerBaseUnit,
      });
      const newQuantity = Number(locked.currentQuantityBaseUnits) + quantityBaseUnits;

      await tx.insert(purchaseLines).values({
        purchaseId: created.id,
        ingredientId: line.ingredientId,
        ingredientNameSnapshot: locked.name,
        ingredientBaseUnitSnapshot: locked.baseUnit,
        quantityPurchased: String(line.quantityPurchased),
        purchaseUnit: line.purchaseUnit,
        conversionToBaseUnits: String(line.conversionToBaseUnits),
        quantityBaseUnits: String(quantityBaseUnits),
        totalLineCost,
        costPerBaseUnit: String(costPerBaseUnit),
      });

      await insertMovementAndApplyStock(
        tx,
        {
          businessId: actor.businessId,
          locationId: input.locationId ?? null,
          ingredientId: line.ingredientId,
          movementType: "PURCHASE_RECEIPT",
          quantityBaseUnits,
          unitCost: String(costPerBaseUnit),
          totalCost: totalLineCost,
          sourceType: "purchase",
          sourceId: created.id,
          createdBy: actor.userId,
        },
        { newQuantityBaseUnits: newQuantity, newAverageCostPerBaseUnit: newAverageCost },
      );
    }

    const [finalized] = await tx
      .update(purchases)
      .set({ status: "FINALIZED", totalCost, finalizedAt: new Date() })
      .where(eq(purchases.id, created.id))
      .returning();

    return finalized;
  });

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "purchase.finalized",
    entityType: "purchase",
    entityId: purchase.id,
    after: purchase,
  });

  return purchase;
}
