import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  ingredients,
  menuCategories,
  menuItemModifierGroups,
  menuItemVariants,
  menuItems,
  modifierGroups,
  modifierOptions,
  modifierRecipeLines,
  recipeLines,
  recipes,
} from "@/lib/db/schema";
import { effectiveQuantity } from "@/lib/recipes/cost";

export interface IngredientDemand {
  ingredientId: string;
  ingredientName: string;
  baseUnit: "gram" | "millilitre" | "piece";
  quantityPerUnit: number; // effective (waste-inclusive) base-unit quantity for ONE unit of the line
  costPerBaseUnit: string; // ingredient's current average cost snapshot
}

/**
 * Recipe ingredient impact for one order line's variant, merged with the
 * recipe impact of every selected modifier option (PRD §6.5: "If the same
 * ingredient is used by a menu item and a modifier, quantities must be
 * summed before inventory deduction"). Quantities already have their
 * per-line waste percentage folded in via `effectiveQuantity`.
 */
export async function calculateLineIngredientDemand(
  db: Database,
  variantId: string,
  modifierOptionIds: string[],
): Promise<Map<string, IngredientDemand>> {
  const demand = new Map<string, IngredientDemand>();

  function addDemand(
    ingredientId: string,
    ingredientName: string,
    baseUnit: "gram" | "millilitre" | "piece",
    costPerBaseUnit: string,
    quantityBaseUnits: string,
    wastePercentage: string | null,
  ) {
    const qty = effectiveQuantity(Number(quantityBaseUnits), Number(wastePercentage ?? 0));
    const existing = demand.get(ingredientId);
    if (existing) {
      existing.quantityPerUnit += qty;
    } else {
      demand.set(ingredientId, { ingredientId, ingredientName, baseUnit, quantityPerUnit: qty, costPerBaseUnit });
    }
  }

  const [activeRecipe] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.menuItemVariantId, variantId), eq(recipes.active, true)))
    .orderBy(desc(recipes.version))
    .limit(1);

  if (activeRecipe) {
    const lines = await db
      .select({
        ingredientId: recipeLines.ingredientId,
        ingredientName: ingredients.name,
        baseUnit: ingredients.baseUnit,
        costPerBaseUnit: ingredients.averageCostPerBaseUnit,
        quantityBaseUnits: recipeLines.quantityBaseUnits,
        wastePercentage: recipeLines.wastePercentage,
      })
      .from(recipeLines)
      .innerJoin(ingredients, eq(recipeLines.ingredientId, ingredients.id))
      .where(eq(recipeLines.recipeId, activeRecipe.id));

    for (const line of lines) {
      addDemand(line.ingredientId, line.ingredientName, line.baseUnit, line.costPerBaseUnit, line.quantityBaseUnits, line.wastePercentage);
    }
  }

  if (modifierOptionIds.length > 0) {
    const modLines = await db
      .select({
        ingredientId: modifierRecipeLines.ingredientId,
        ingredientName: ingredients.name,
        baseUnit: ingredients.baseUnit,
        costPerBaseUnit: ingredients.averageCostPerBaseUnit,
        quantityBaseUnits: modifierRecipeLines.quantityBaseUnits,
        wastePercentage: modifierRecipeLines.wastePercentage,
      })
      .from(modifierRecipeLines)
      .innerJoin(ingredients, eq(modifierRecipeLines.ingredientId, ingredients.id))
      .where(inArray(modifierRecipeLines.modifierOptionId, modifierOptionIds));

    for (const line of modLines) {
      addDemand(line.ingredientId, line.ingredientName, line.baseUnit, line.costPerBaseUnit, line.quantityBaseUnits, line.wastePercentage);
    }
  }

  return demand;
}

/**
 * For an order line with no variant (the item has none) — priced directly
 * off the item's base price. There is no recipe row to look up here:
 * `recipes.menuItemVariantId` is NOT NULL, so an item sold this way never
 * produces ingredient consumption or COGS, regardless of its
 * `tracksInventory` flag. The caller rejects this path if any variant exists. Scoped by business.
 */
export async function getMenuItemForOrder(db: Database, businessId: string, menuItemId: string) {
  const [row] = await db
    .select({
      menuItemId: menuItems.id,
      menuItemName: menuItems.name,
      menuItemActive: menuItems.active,
      basePrice: menuItems.basePrice,
      categoryName: menuCategories.name,
    })
    .from(menuItems)
    .leftJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(and(eq(menuItems.id, menuItemId), eq(menuItems.businessId, businessId)))
    .limit(1);
  return row ?? null;
}

/** Scoped by business so a client can never order against another business's variant id. */
export async function getVariantWithItem(db: Database, businessId: string, variantId: string) {
  const [row] = await db
    .select({
      variantId: menuItemVariants.id,
      variantName: menuItemVariants.name,
      variantPrice: menuItemVariants.price,
      variantActive: menuItemVariants.active,
      menuItemId: menuItems.id,
      menuItemName: menuItems.name,
      menuItemActive: menuItems.active,
      tracksInventory: menuItems.tracksInventory,
      categoryName: menuCategories.name,
    })
    .from(menuItemVariants)
    .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
    .leftJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(and(eq(menuItemVariants.id, variantId), eq(menuItems.businessId, businessId)))
    .limit(1);
  return row ?? null;
}

/** Scoped by business so a client can't reference another business's modifier options. */
export async function getModifierOptionsById(db: Database, businessId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: modifierOptions.id,
      modifierGroupId: modifierOptions.modifierGroupId,
      name: modifierOptions.name,
      priceAdjustment: modifierOptions.priceAdjustment,
      active: modifierOptions.active,
    })
    .from(modifierOptions)
    .innerJoin(modifierGroups, eq(modifierOptions.modifierGroupId, modifierGroups.id))
    .where(and(inArray(modifierOptions.id, ids), eq(modifierGroups.businessId, businessId)));
}

/** Read every assigned group, including required groups with no selected options. */
export async function getOrderSelectionRules(db: Database, businessId: string, menuItemId: string) {
  const variants = await db.select({ id: menuItemVariants.id }).from(menuItemVariants)
    .innerJoin(menuItems, eq(menuItems.id, menuItemVariants.menuItemId))
    .where(and(eq(menuItems.id, menuItemId), eq(menuItems.businessId, businessId)));
  const groups = await db.select({ id: modifierGroups.id, name: modifierGroups.name,
    active: modifierGroups.active, required: modifierGroups.required,
    minSelections: modifierGroups.minSelections, maxSelections: modifierGroups.maxSelections })
    .from(menuItemModifierGroups)
    .innerJoin(modifierGroups, eq(modifierGroups.id, menuItemModifierGroups.modifierGroupId))
    .where(and(eq(menuItemModifierGroups.menuItemId, menuItemId), eq(modifierGroups.businessId, businessId)));
  return { variants, groups };
}
