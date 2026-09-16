import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ingredients, wasteRecords } from "@/lib/db/schema";
import type { BusinessDateRange } from "@/lib/dates/dates";
import { microsToRupiah, multiplyQuantityByRate } from "@/lib/money/money";
import { formatQuantityUnits, toQuantityUnits } from "@/lib/units/units";
import type { WasteInput } from "@/lib/validation/waste";
import { recordAuditLog } from "./audit";
import { InsufficientStockError, insertMovementsAndApplyStock, lockIngredientsForUpdate } from "./inventory-service";
import type { ActorContext } from "./ingredient-service";
import { withinBusinessDays } from "./range-filters";

/** Newest first; `range` filters on created_at by Jakarta business day. */
function wasteFilter(businessId: string, range?: BusinessDateRange) {
  const conditions = [eq(wasteRecords.businessId, businessId)];
  if (range) conditions.push(withinBusinessDays(wasteRecords.createdAt, range));
  return and(...conditions);
}

export async function countWasteRecords(db: Database, businessId: string, opts: { range?: BusinessDateRange } = {}) {
  return db.$count(wasteRecords, wasteFilter(businessId, opts.range));
}

export async function listWasteRecords(
  db: Database,
  businessId: string,
  opts: { range?: BusinessDateRange; limit: number; offset: number },
) {
  return db
    .select({
      id: wasteRecords.id,
      ingredientId: wasteRecords.ingredientId,
      ingredientName: sql<string>`coalesce(${ingredients.name}, ${wasteRecords.ingredientNameSnapshot}, 'Deleted ingredient')`,
      baseUnit: sql<"gram" | "millilitre" | "piece">`coalesce(${ingredients.baseUnit}, ${wasteRecords.ingredientBaseUnitSnapshot}, 'gram')`,
      displayUnit: ingredients.displayUnit,
      quantityBaseUnits: wasteRecords.quantityBaseUnits,
      reason: wasteRecords.reason,
      estimatedCost: wasteRecords.estimatedCost,
      notes: wasteRecords.notes,
      createdAt: wasteRecords.createdAt,
    })
    .from(wasteRecords)
    .leftJoin(ingredients, eq(wasteRecords.ingredientId, ingredients.id))
    .where(wasteFilter(businessId, opts.range))
    .orderBy(desc(wasteRecords.createdAt), desc(wasteRecords.id))
    .limit(opts.limit)
    .offset(opts.offset);
}

/**
 * Recording waste decreases stock and always allows going to exactly zero
 * (never below what's on hand) regardless of the business's negative-stock
 * setting — waste can't consume ingredient that isn't there. The
 * transaction locks the ingredient row so a waste entry racing a
 * concurrent sale/purchase can't lose an update, and the ledger row points
 * back at the waste record it came from.
 */
export async function createWasteRecord(db: Database, actor: ActorContext, input: WasteInput) {
  return db.transaction(async (tx) => {
    const locked = await lockIngredientsForUpdate(tx, actor.businessId, [input.ingredientId]);
    const ingredient = locked.get(input.ingredientId)!;
    const units = toQuantityUnits(input.quantityBaseUnits);
    const remaining = toQuantityUnits(ingredient.currentQuantityBaseUnits) - units;
    if (remaining < 0n) {
      throw new InsufficientStockError(ingredient.name, Number(formatQuantityUnits(-remaining)));
    }
    const estimatedCost = microsToRupiah(multiplyQuantityByRate(input.quantityBaseUnits, ingredient.averageCostPerBaseUnit));

    const [waste] = await tx
      .insert(wasteRecords)
      .values({
        businessId: actor.businessId,
        ingredientId: input.ingredientId,
        ingredientNameSnapshot: ingredient.name,
        ingredientBaseUnitSnapshot: ingredient.baseUnit,
        quantityBaseUnits: formatQuantityUnits(units),
        reason: input.reason,
        estimatedCost,
        notes: input.notes || null,
        createdBy: actor.userId,
      })
      .returning();

    await insertMovementsAndApplyStock(
      tx,
      [
        {
          id: randomUUID(),
          businessId: actor.businessId,
          ingredientId: input.ingredientId,
          movementType: "WASTE",
          quantityUnits: -units,
          unitCost: ingredient.averageCostPerBaseUnit,
          totalCost: estimatedCost,
          sourceType: "waste_record",
          sourceId: waste.id,
          reason: input.reason,
          notes: input.notes ?? null,
          createdBy: actor.userId,
        },
      ],
      locked,
    );

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "waste.recorded",
      entityType: "waste_record",
      entityId: waste.id,
      after: waste,
    });

    return waste;
  });
}
