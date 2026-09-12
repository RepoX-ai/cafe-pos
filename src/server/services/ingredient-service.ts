import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ingredients } from "@/lib/db/schema";
import type { IngredientInput } from "@/lib/validation/ingredient";
import { recordAuditLog } from "./audit";

export async function listIngredients(db: Database, businessId: string, opts: { includeArchived?: boolean } = {}) {
  const rows = await db
    .select()
    .from(ingredients)
    .where(
      opts.includeArchived
        ? eq(ingredients.businessId, businessId)
        : and(eq(ingredients.businessId, businessId), eq(ingredients.active, true)),
    )
    .orderBy(asc(ingredients.name));
  return rows;
}

export async function getIngredientById(db: Database, businessId: string, id: string) {
  const [row] = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.id, id), eq(ingredients.businessId, businessId)))
    .limit(1);
  return row ?? null;
}

export interface ActorContext {
  businessId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * New ingredients always start at zero stock — stock only ever enters the
 * ledger through an explicit movement (opening balance, purchase, or
 * adjustment), never as a side effect of editing the ingredient record (PRD
 * §1.3). Average cost is the exception: it's a plain rate column (not a
 * movement), so an optional starting value can seed it here purely so
 * recipes/menu items can be costed before the first purchase exists. The
 * next real purchase still recalculates it via the normal weighted-average
 * formula, blending over this seed like any other receipt.
 */
export async function createIngredient(db: Database, actor: ActorContext, input: IngredientInput) {
  const [row] = await db
    .insert(ingredients)
    .values({
      businessId: actor.businessId,
      name: input.name,
      sku: input.sku || null,
      category: input.category || null,
      baseUnit: input.baseUnit,
      reorderLevelBaseUnits:
        input.reorderLevelBaseUnits !== undefined ? String(input.reorderLevelBaseUnits) : null,
      targetStockBaseUnits:
        input.targetStockBaseUnits !== undefined ? String(input.targetStockBaseUnits) : null,
      ...(input.startingCostPerBaseUnit !== undefined
        ? { averageCostPerBaseUnit: String(input.startingCostPerBaseUnit) }
        : {}),
      notes: input.notes || null,
    })
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "ingredient.created",
    entityType: "ingredient",
    entityId: row.id,
    after: row,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return row;
}

export async function updateIngredient(
  db: Database,
  actor: ActorContext,
  id: string,
  input: IngredientInput,
) {
  const before = await getIngredientById(db, actor.businessId, id);
  if (!before) throw new Error("Ingredient not found");

  const [row] = await db
    .update(ingredients)
    .set({
      name: input.name,
      sku: input.sku || null,
      category: input.category || null,
      baseUnit: input.baseUnit,
      reorderLevelBaseUnits:
        input.reorderLevelBaseUnits !== undefined ? String(input.reorderLevelBaseUnits) : null,
      targetStockBaseUnits:
        input.targetStockBaseUnits !== undefined ? String(input.targetStockBaseUnits) : null,
      notes: input.notes || null,
      updatedAt: new Date(),
    })
    .where(and(eq(ingredients.id, id), eq(ingredients.businessId, actor.businessId)))
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "ingredient.updated",
    entityType: "ingredient",
    entityId: id,
    before,
    after: row,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return row;
}

/**
 * Ingredients are archived, never hard-deleted — historical movements,
 * recipe lines, and order consumption rows all reference them (PRD §6.4).
 */
export async function setIngredientActive(
  db: Database,
  actor: ActorContext,
  id: string,
  active: boolean,
) {
  const before = await getIngredientById(db, actor.businessId, id);
  if (!before) throw new Error("Ingredient not found");

  const [row] = await db
    .update(ingredients)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(ingredients.id, id), eq(ingredients.businessId, actor.businessId)))
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: active ? "ingredient.restored" : "ingredient.archived",
    entityType: "ingredient",
    entityId: id,
    before,
    after: row,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return row;
}
