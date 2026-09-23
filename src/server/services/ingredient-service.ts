import { and, asc, count, eq, getTableColumns, isNotNull, lte, sql } from "drizzle-orm";
import { NotFoundError, ServiceError } from "./errors";
import type { Database } from "@/lib/db/client";
import {
  ingredients,
  inventoryMovements,
  menuItems,
  menuItemVariants,
  modifierGroups,
  modifierOptions,
  modifierRecipeLines,
  recipeLines,
  recipes,
} from "@/lib/db/schema";
import { baseUnitOfDisplayUnit, purchaseScaleFor, type BaseUnit, type DisplayUnit } from "@/lib/units/units";
import type { IngredientInput, IngredientUpdateInput } from "@/lib/validation/ingredient";
import { recordAuditLog } from "./audit";

/**
 * Whether any stock movement — purchase, count, sale, waste — exists for
 * the ingredient. Until one does, its average cost is only the estimate
 * typed at creation and can still be corrected; after, purchases own it.
 */
function hasStockHistory() {
  return sql<boolean>`exists (select 1 from ${inventoryMovements} where ${inventoryMovements.ingredientId} = ${ingredients.id})`;
}

export class IngredientValidationError extends ServiceError {}

function assertDisplayUnitMatches(baseUnit: BaseUnit, displayUnit: DisplayUnit | undefined) {
  if (displayUnit && baseUnitOfDisplayUnit(displayUnit) !== baseUnit) {
    throw new IngredientValidationError(`"${displayUnit}" can't be used for an ingredient measured in ${baseUnit}s.`);
  }
}

export async function listIngredients(db: Database, businessId: string, opts: { includeArchived?: boolean } = {}) {
  const rows = await db
    .select({ ...getTableColumns(ingredients), hasStockHistory: hasStockHistory() })
    .from(ingredients)
    .where(
      opts.includeArchived
        ? eq(ingredients.businessId, businessId)
        : and(eq(ingredients.businessId, businessId), eq(ingredients.active, true)),
    )
    .orderBy(asc(ingredients.name));
  return rows;
}

/** Active ingredients at or below their reorder level, by name — filtered in SQL, not after loading everything. */
export async function listLowStockIngredients(db: Database, businessId: string) {
  return db
    .select()
    .from(ingredients)
    .where(
      and(
        eq(ingredients.businessId, businessId),
        eq(ingredients.active, true),
        isNotNull(ingredients.reorderLevelBaseUnits),
        lte(ingredients.currentQuantityBaseUnits, ingredients.reorderLevelBaseUnits),
      ),
    )
    .orderBy(asc(ingredients.name));
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
  return db.transaction(async (tx) => {
    assertDisplayUnitMatches(input.baseUnit, input.displayUnit);
    const [row] = await tx
      .insert(ingredients)
      .values({
        businessId: actor.businessId,
        name: input.name,
        sku: input.sku || null,
        category: input.category || null,
        baseUnit: input.baseUnit,
        displayUnit: input.displayUnit ?? null,
        reorderLevelBaseUnits:
          input.reorderLevelBaseUnits !== undefined ? String(input.reorderLevelBaseUnits) : null,
        targetStockBaseUnits:
          input.targetStockBaseUnits !== undefined ? String(input.targetStockBaseUnits) : null,
        ...(input.startingCostPerPurchaseUnit !== undefined
          ? {
              averageCostPerBaseUnit: String(
                input.startingCostPerPurchaseUnit / purchaseScaleFor(input.baseUnit).baseUnitsPer,
              ),
            }
          : {}),
        notes: input.notes || null,
      })
      .returning();

    await recordAuditLog(tx, {
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
  });
}

export async function updateIngredient(
  db: Database,
  actor: ActorContext,
  id: string,
  input: IngredientUpdateInput,
) {
  return db.transaction(async (tx) => {
    // Locked, not just read: the "no stock history yet" check below must
    // still hold when the typed cost is written, and every stock movement
    // (purchase, sale, count) takes this same row lock.
    const [before] = await tx
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.businessId, actor.businessId)))
      .for("update");
    if (!before) throw new NotFoundError("Ingredient not found");
    // Display only, so it can change even after stock history exists — but
    // never across classes, which would misread every quantity typed after.
    assertDisplayUnitMatches(before.baseUnit, input.displayUnit);

    let averageCostPerBaseUnit: string | undefined;
    if (input.startingCostPerPurchaseUnit !== undefined) {
      const [{ locked }] = await tx
        .select({ locked: hasStockHistory() })
        .from(ingredients)
        .where(eq(ingredients.id, id));
      if (locked) {
        throw new IngredientValidationError(
          "This ingredient already has stock history, so its cost comes from purchases and can't be typed in.",
        );
      }
      averageCostPerBaseUnit = String(
        input.startingCostPerPurchaseUnit / purchaseScaleFor(before.baseUnit).baseUnitsPer,
      );
    }

    const [row] = await tx
      .update(ingredients)
      .set({
        ...(averageCostPerBaseUnit !== undefined ? { averageCostPerBaseUnit } : {}),
        ...(input.displayUnit ? { displayUnit: input.displayUnit } : {}),
        name: input.name,
        sku: input.sku || null,
        category: input.category || null,
        reorderLevelBaseUnits:
          input.reorderLevelBaseUnits !== undefined ? String(input.reorderLevelBaseUnits) : null,
        targetStockBaseUnits:
          input.targetStockBaseUnits !== undefined ? String(input.targetStockBaseUnits) : null,
        notes: input.notes || null,
        updatedAt: new Date(),
      })
      .where(and(eq(ingredients.id, id), eq(ingredients.businessId, actor.businessId)))
      .returning();

    await recordAuditLog(tx, {
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
  });
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
  return db.transaction(async (tx) => {
    const before = await getIngredientById(tx, actor.businessId, id);
    if (!before) throw new NotFoundError("Ingredient not found");

    const [row] = await tx
      .update(ingredients)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(ingredients.id, id), eq(ingredients.businessId, actor.businessId)))
      .returning();

    await recordAuditLog(tx, {
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
  });
}

/**
 * Counts the recipes an ingredient is still part of, so the confirm dialog
 * can say how many menu items get cheaper to make before anyone commits.
 */
async function countRecipeUsage(db: Database, businessId: string, id: string) {
  const [itemRecipes] = await db
    .select({ total: count() })
    .from(recipeLines)
    .innerJoin(recipes, eq(recipeLines.recipeId, recipes.id))
    .innerJoin(menuItemVariants, eq(recipes.menuItemVariantId, menuItemVariants.id))
    .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
    .where(and(eq(recipeLines.ingredientId, id), eq(menuItems.businessId, businessId)));

  const [modifierRecipes] = await db
    .select({ total: count() })
    .from(modifierRecipeLines)
    .innerJoin(modifierOptions, eq(modifierRecipeLines.modifierOptionId, modifierOptions.id))
    .innerJoin(modifierGroups, eq(modifierOptions.modifierGroupId, modifierGroups.id))
    .where(and(eq(modifierRecipeLines.ingredientId, id), eq(modifierGroups.businessId, businessId)));

  return { recipeLines: itemRecipes?.total ?? 0, modifierLines: modifierRecipes?.total ?? 0 };
}

/**
 * Deletes the ingredient outright — the owner's call, not gated on whether
 * it has been used.
 *
 * Stock and cost history survives: `inventory_movements`,
 * `order_ingredient_consumption`, `purchase_lines`, `waste_records` and
 * `stock_count_lines` each keep their own `ingredient_name_snapshot` and
 * unit, and their FK is ON DELETE SET NULL — so the ledger, the COGS audit
 * trail and past purchase/waste records all still read correctly, and no
 * order's totals move (order COGS is its own integer column).
 *
 * What does change going forward: the ingredient drops out of every recipe
 * that used it (ON DELETE CASCADE on `recipe_lines` /
 * `modifier_recipe_lines`), so those menu items cost that much less to make
 * from now on. `countRecipeUsage` is what the UI warns with beforehand.
 */
export async function deleteIngredient(db: Database, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [ingredient] = await tx
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.businessId, actor.businessId)))
      .limit(1);
    if (!ingredient) throw new NotFoundError("Ingredient not found");

    const usage = await countRecipeUsage(tx, actor.businessId, id);

    await tx
      .delete(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.businessId, actor.businessId)));

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "ingredient.deleted",
      entityType: "ingredient",
      entityId: id,
      before: ingredient,
      metadata: { removedFromRecipeLines: usage.recipeLines, removedFromModifierLines: usage.modifierLines },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return ingredient;
  });
}

/**
 * How many recipe lines each ingredient still appears in, across item
 * recipes and modifier recipes, keyed by ingredient id. The ingredients
 * list uses it to warn — before the delete, not after — how many recipes
 * the ingredient is about to drop out of.
 */
export async function getRecipeUsageByIngredient(db: Database, businessId: string) {
  const itemRows = await db
    .select({ ingredientId: recipeLines.ingredientId, total: count() })
    .from(recipeLines)
    .innerJoin(recipes, eq(recipeLines.recipeId, recipes.id))
    .innerJoin(menuItemVariants, eq(recipes.menuItemVariantId, menuItemVariants.id))
    .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
    .where(eq(menuItems.businessId, businessId))
    .groupBy(recipeLines.ingredientId);

  const modifierRows = await db
    .select({ ingredientId: modifierRecipeLines.ingredientId, total: count() })
    .from(modifierRecipeLines)
    .innerJoin(modifierOptions, eq(modifierRecipeLines.modifierOptionId, modifierOptions.id))
    .innerJoin(modifierGroups, eq(modifierOptions.modifierGroupId, modifierGroups.id))
    .where(eq(modifierGroups.businessId, businessId))
    .groupBy(modifierRecipeLines.ingredientId);

  const usage: Record<string, number> = {};
  for (const row of [...itemRows, ...modifierRows]) {
    usage[row.ingredientId] = (usage[row.ingredientId] ?? 0) + row.total;
  }
  return usage;
}
