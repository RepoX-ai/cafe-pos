import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ingredients, wasteRecords } from "@/lib/db/schema";
import type { BusinessDateRange } from "@/lib/dates/dates";
import { microsToRupiah, multiplyQuantityByRate } from "@/lib/money/money";
import type { WasteInput } from "@/lib/validation/waste";
import { recordAuditLog } from "./audit";
import { applyStockMovement, lockIngredientForUpdate } from "./inventory-service";
import type { ActorContext } from "./ingredient-service";
import { withinBusinessDays } from "./range-filters";

/** Newest first; `range` filters on created_at by Jakarta business day. */
export async function listWasteRecords(
  db: Database,
  businessId: string,
  opts: { range?: BusinessDateRange; limit: number; offset: number },
) {
  const conditions = [eq(wasteRecords.businessId, businessId)];
  if (opts.range) conditions.push(withinBusinessDays(wasteRecords.createdAt, opts.range));
  return db
    .select({
      id: wasteRecords.id,
      ingredientId: wasteRecords.ingredientId,
      ingredientName: sql<string>`coalesce(${ingredients.name}, ${wasteRecords.ingredientNameSnapshot}, 'Deleted ingredient')`,
      baseUnit: sql<"gram" | "millilitre" | "piece">`coalesce(${ingredients.baseUnit}, ${wasteRecords.ingredientBaseUnitSnapshot}, 'gram')`,
      quantityBaseUnits: wasteRecords.quantityBaseUnits,
      reason: wasteRecords.reason,
      estimatedCost: wasteRecords.estimatedCost,
      notes: wasteRecords.notes,
      createdAt: wasteRecords.createdAt,
    })
    .from(wasteRecords)
    .leftJoin(ingredients, eq(wasteRecords.ingredientId, ingredients.id))
    .where(and(...conditions))
    .orderBy(desc(wasteRecords.createdAt), desc(wasteRecords.id))
    .limit(opts.limit)
    .offset(opts.offset);
}

/**
 * Recording waste decreases stock and always allows going to exactly zero
 * (never below what's on hand) regardless of the business's negative-stock
 * setting — waste can't consume ingredient that isn't there. The
 * transaction still locks the ingredient row so a waste entry racing a
 * concurrent sale/purchase can't lose an update.
 */
export async function createWasteRecord(db: Database, actor: ActorContext, input: WasteInput) {
  const result = await db.transaction(async (tx) => {
    const locked = await lockIngredientForUpdate(tx, actor.businessId, input.ingredientId);
    const estimatedCost = microsToRupiah(
      multiplyQuantityByRate(input.quantityBaseUnits, locked.averageCostPerBaseUnit),
    );

    await applyStockMovement(
      tx,
      actor,
      {
        ingredientId: input.ingredientId,
        movementType: "WASTE",
        quantityBaseUnits: -input.quantityBaseUnits,
        unitCost: locked.averageCostPerBaseUnit,
        totalCost: estimatedCost,
        sourceType: "waste_record",
        reason: input.reason,
        notes: input.notes ?? null,
      },
      { allowNegativeStock: false },
    );

    const [waste] = await tx
      .insert(wasteRecords)
      .values({
        businessId: actor.businessId,
        ingredientId: input.ingredientId,
        ingredientNameSnapshot: locked.name,
        ingredientBaseUnitSnapshot: locked.baseUnit,
        quantityBaseUnits: String(input.quantityBaseUnits),
        reason: input.reason,
        estimatedCost,
        notes: input.notes || null,
        createdBy: actor.userId,
      })
      .returning();

    return waste;
  });

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "waste.recorded",
    entityType: "waste_record",
    entityId: result.id,
    after: result,
  });

  return result;
}
