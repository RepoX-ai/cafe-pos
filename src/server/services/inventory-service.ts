import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ingredients, inventoryMovements } from "@/lib/db/schema";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

export class InsufficientStockError extends Error {
  constructor(
    public ingredientName: string,
    public shortfallBaseUnits: number,
  ) {
    super(`Insufficient stock for "${ingredientName}" (short by ${shortfallBaseUnits}).`);
    this.name = "InsufficientStockError";
  }
}

type MovementType = (typeof inventoryMovements.movementType.enumValues)[number];

/**
 * Locks the ingredient row for the remainder of the transaction (`SELECT
 * ... FOR UPDATE`) so two concurrent movements against the same ingredient
 * can't both read the same starting quantity and silently lose one
 * update (PRD §8: "Lock or safely re-read relevant ingredient rows").
 * Must be called inside `db.transaction(...)`.
 */
export async function lockIngredientForUpdate(tx: Database, businessId: string, ingredientId: string) {
  const [row] = await tx
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.id, ingredientId), eq(ingredients.businessId, businessId)))
    .for("update");
  if (!row) throw new Error("Ingredient not found");
  return row;
}

export interface InsertMovementInput {
  businessId: string;
  locationId?: string | null;
  ingredientId: string;
  movementType: MovementType;
  quantityBaseUnits: number; // signed: positive = inbound, negative = outbound
  unitCost?: string | null;
  totalCost?: number | null;
  sourceType: string;
  sourceId?: string | null;
  relatedMovementId?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * Inserts the ledger row and applies the resulting quantity (and,
 * optionally, a new average cost) to the ingredient's cached fields, in
 * the same transaction. Callers must have already locked the ingredient
 * row via `lockIngredientForUpdate` and computed `newQuantity` from that
 * locked value — this function does not re-read or re-check stock itself.
 */
export async function insertMovementAndApplyStock(
  tx: Database,
  input: InsertMovementInput,
  effects: { newQuantityBaseUnits: number; newAverageCostPerBaseUnit?: number },
) {
  // Snapshot the ingredient's name/unit onto the ledger row, so the row
  // still reads correctly if the ingredient is deleted later (the FK then
  // goes NULL). Callers have already locked this row, so this is a read of
  // a row this transaction is holding.
  const [snapshot] = await tx
    .select({ name: ingredients.name, baseUnit: ingredients.baseUnit })
    .from(ingredients)
    .where(eq(ingredients.id, input.ingredientId))
    .limit(1);

  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      businessId: input.businessId,
      locationId: input.locationId ?? null,
      ingredientId: input.ingredientId,
      ingredientNameSnapshot: snapshot?.name ?? null,
      ingredientBaseUnitSnapshot: snapshot?.baseUnit ?? null,
      movementType: input.movementType,
      quantityBaseUnits: String(input.quantityBaseUnits),
      unitCost: input.unitCost ?? null,
      totalCost: input.totalCost ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      relatedMovementId: input.relatedMovementId ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  await tx
    .update(ingredients)
    .set({
      currentQuantityBaseUnits: String(effects.newQuantityBaseUnits),
      ...(effects.newAverageCostPerBaseUnit !== undefined
        ? { averageCostPerBaseUnit: String(effects.newAverageCostPerBaseUnit) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(ingredients.id, input.ingredientId));

  return movement;
}

/**
 * Convenience wrapper for the common case (waste, manual adjustments,
 * stock-count corrections, sale consumption/reversal): lock, check
 * negative-stock policy, insert movement, update cached quantity — all in
 * one call. Purchases don't use this because they also need to update the
 * average cost in the same statement; see `purchase-service.ts`.
 */
export async function applyStockMovement(
  tx: Database,
  actor: ActorContext,
  input: Omit<InsertMovementInput, "businessId" | "createdBy">,
  opts: { allowNegativeStock: boolean },
) {
  const locked = await lockIngredientForUpdate(tx, actor.businessId, input.ingredientId);
  const newQuantity = Number(locked.currentQuantityBaseUnits) + input.quantityBaseUnits;

  if (newQuantity < 0 && !opts.allowNegativeStock) {
    throw new InsufficientStockError(locked.name, Math.abs(newQuantity));
  }

  return insertMovementAndApplyStock(
    tx,
    { ...input, businessId: actor.businessId, createdBy: actor.userId },
    { newQuantityBaseUnits: newQuantity },
  );
}

export interface ManualAdjustmentInput {
  ingredientId: string;
  direction: "in" | "out";
  quantityBaseUnits: number; // always positive; direction determines sign
  reason: string;
  notes?: string;
}

/**
 * Manual stock adjustments (PRD movement types MANUAL_ADJUSTMENT_IN /
 * MANUAL_ADJUSTMENT_OUT) — for corrections outside the purchase, waste, or
 * stock-count flows. Every adjustment requires a reason and is audited.
 */
export async function createManualAdjustment(
  db: Database,
  actor: ActorContext,
  input: ManualAdjustmentInput,
  opts: { allowNegativeStock: boolean },
) {
  const signedQuantity = input.direction === "in" ? input.quantityBaseUnits : -input.quantityBaseUnits;

  const movement = await db.transaction((tx) =>
    applyStockMovement(
      tx,
      actor,
      {
        ingredientId: input.ingredientId,
        movementType: input.direction === "in" ? "MANUAL_ADJUSTMENT_IN" : "MANUAL_ADJUSTMENT_OUT",
        quantityBaseUnits: signedQuantity,
        sourceType: "manual_adjustment",
        reason: input.reason,
        notes: input.notes ?? null,
      },
      opts,
    ),
  );

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "inventory.manual_adjustment",
    entityType: "inventory_movement",
    entityId: movement.id,
    metadata: input,
  });

  return movement;
}

export async function listMovements(
  db: Database,
  businessId: string,
  opts: { ingredientId?: string; limit?: number } = {},
) {
  const conditions = [eq(inventoryMovements.businessId, businessId)];
  if (opts.ingredientId) conditions.push(eq(inventoryMovements.ingredientId, opts.ingredientId));

  return db
    .select({
      id: inventoryMovements.id,
      ingredientId: inventoryMovements.ingredientId,
      // Prefer the live ingredient, fall back to what the row recorded —
      // the fallback is what a deleted ingredient's movements read as.
      ingredientName: sql<string>`coalesce(${ingredients.name}, ${inventoryMovements.ingredientNameSnapshot}, 'Deleted ingredient')`,
      baseUnit: sql<"gram" | "millilitre" | "piece">`coalesce(${ingredients.baseUnit}, ${inventoryMovements.ingredientBaseUnitSnapshot}, 'gram')`,
      movementType: inventoryMovements.movementType,
      quantityBaseUnits: inventoryMovements.quantityBaseUnits,
      unitCost: inventoryMovements.unitCost,
      totalCost: inventoryMovements.totalCost,
      sourceType: inventoryMovements.sourceType,
      sourceId: inventoryMovements.sourceId,
      reason: inventoryMovements.reason,
      notes: inventoryMovements.notes,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .leftJoin(ingredients, eq(inventoryMovements.ingredientId, ingredients.id))
    .where(and(...conditions))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(opts.limit ?? 200);
}
