import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
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

export interface OrderCatalogLine {
  menuItemId: string;
  menuItemVariantId?: string | null;
  modifierOptionIds: string[];
}

interface RecipeLineRow {
  ingredientId: string;
  quantityBaseUnits: string;
  wastePercentage: string | null;
}

const unique = <T,>(values: T[]) => [...new Set(values)];

/**
 * Everything checkout needs to validate and cost a cart, read in a fixed
 * number of queries no matter how many lines it has. Every lookup is scoped
 * by business, so a client can never order against another business's
 * variants, items, or modifier options.
 */
export async function loadOrderCatalog(db: Database, businessId: string, lines: OrderCatalogLine[]) {
  const itemIds = unique(lines.map((line) => line.menuItemId));
  const variantIds = unique(lines.flatMap((line) => (line.menuItemVariantId ? [line.menuItemVariantId] : [])));
  const baseItemIds = unique(lines.filter((line) => !line.menuItemVariantId).map((line) => line.menuItemId));
  const optionIds = unique(lines.flatMap((line) => line.modifierOptionIds));

  const variantRows =
    variantIds.length > 0
      ? await db
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
          .leftJoin(menuCategories, and(eq(menuItems.categoryId, menuCategories.id), eq(menuCategories.businessId, businessId)))
          .where(and(inArray(menuItemVariants.id, variantIds), eq(menuItems.businessId, businessId)))
      : [];

  // Lines without a variant are priced off the item itself, which is only
  // allowed when the item has no variants at all (active or not).
  const baseItemRows =
    baseItemIds.length > 0
      ? await db
          .select({
            menuItemId: menuItems.id,
            menuItemName: menuItems.name,
            menuItemActive: menuItems.active,
            basePrice: menuItems.basePrice,
            categoryName: menuCategories.name,
            variantCount: sql<number>`(select count(*)::int from menu_item_variants v where v.menu_item_id = ${menuItems.id})`,
          })
          .from(menuItems)
          .leftJoin(menuCategories, and(eq(menuItems.categoryId, menuCategories.id), eq(menuCategories.businessId, businessId)))
          .where(and(inArray(menuItems.id, baseItemIds), eq(menuItems.businessId, businessId)))
      : [];

  // Every assigned group, including required groups with no selected options.
  const groupRows = await db
    .select({
      menuItemId: menuItemModifierGroups.menuItemId,
      id: modifierGroups.id,
      name: modifierGroups.name,
      active: modifierGroups.active,
      required: modifierGroups.required,
      minSelections: modifierGroups.minSelections,
      maxSelections: modifierGroups.maxSelections,
    })
    .from(menuItemModifierGroups)
    .innerJoin(modifierGroups, eq(modifierGroups.id, menuItemModifierGroups.modifierGroupId))
    .where(
      and(
        inArray(menuItemModifierGroups.menuItemId, itemIds),
        eq(menuItemModifierGroups.businessId, businessId),
        eq(modifierGroups.businessId, businessId),
      ),
    );

  const optionRows =
    optionIds.length > 0
      ? await db
          .select({
            id: modifierOptions.id,
            modifierGroupId: modifierOptions.modifierGroupId,
            name: modifierOptions.name,
            priceAdjustment: modifierOptions.priceAdjustment,
            active: modifierOptions.active,
          })
          .from(modifierOptions)
          .innerJoin(modifierGroups, eq(modifierOptions.modifierGroupId, modifierGroups.id))
          .where(and(inArray(modifierOptions.id, optionIds), eq(modifierGroups.businessId, businessId)))
      : [];

  // An item sold without a variant has no recipe row (recipes are keyed by
  // variant), so only tracked variants ever consume stock or carry COGS.
  const trackedVariantIds = variantRows.map((row) => row.variantId);
  const recipeLinesByVariant = new Map<string, RecipeLineRow[]>();
  if (trackedVariantIds.length > 0) {
    const latest = db
      .selectDistinctOn([recipes.menuItemVariantId], { id: recipes.id, variantId: recipes.menuItemVariantId })
      .from(recipes)
      .where(and(inArray(recipes.menuItemVariantId, trackedVariantIds), eq(recipes.active, true), eq(recipes.businessId, businessId)))
      .orderBy(recipes.menuItemVariantId, desc(recipes.version))
      .as("latest_recipe");
    const rows = await db
      .select({
        variantId: latest.variantId,
        ingredientId: recipeLines.ingredientId,
        quantityBaseUnits: recipeLines.quantityBaseUnits,
        wastePercentage: recipeLines.wastePercentage,
      })
      .from(recipeLines)
      .innerJoin(latest, eq(recipeLines.recipeId, latest.id));
    for (const row of rows) {
      const list = recipeLinesByVariant.get(row.variantId) ?? [];
      list.push(row);
      recipeLinesByVariant.set(row.variantId, list);
    }
  }

  const modifierLinesByOption = new Map<string, RecipeLineRow[]>();
  if (optionIds.length > 0 && trackedVariantIds.length > 0) {
    const rows = await db
      .select({
        modifierOptionId: modifierRecipeLines.modifierOptionId,
        ingredientId: modifierRecipeLines.ingredientId,
        quantityBaseUnits: modifierRecipeLines.quantityBaseUnits,
        wastePercentage: modifierRecipeLines.wastePercentage,
      })
      .from(modifierRecipeLines)
      .where(and(inArray(modifierRecipeLines.modifierOptionId, optionIds), eq(modifierRecipeLines.businessId, businessId)));
    for (const row of rows) {
      const list = modifierLinesByOption.get(row.modifierOptionId) ?? [];
      list.push(row);
      modifierLinesByOption.set(row.modifierOptionId, list);
    }
  }

  const groupsByItem = new Map<string, typeof groupRows>();
  for (const row of groupRows) {
    const list = groupsByItem.get(row.menuItemId) ?? [];
    list.push(row);
    groupsByItem.set(row.menuItemId, list);
  }

  return {
    variants: new Map(variantRows.map((row) => [row.variantId, row])),
    baseItems: new Map(baseItemRows.map((row) => [row.menuItemId, row])),
    groupsByItem,
    options: new Map(optionRows.map((row) => [row.id, row])),
    recipeLinesByVariant,
    modifierLinesByOption,
  };
}

export type OrderCatalog = Awaited<ReturnType<typeof loadOrderCatalog>>;

/**
 * Per-unit ingredient demand for one order line: the variant's active recipe
 * merged with every selected modifier's recipe (PRD §6.5: "If the same
 * ingredient is used by a menu item and a modifier, quantities must be
 * summed before inventory deduction"), waste percentage folded in.
 */
export function lineDemandPerUnit(catalog: OrderCatalog, variantId: string, modifierOptionIds: string[]) {
  const demand = new Map<string, number>();
  addDemand(demand, catalog.recipeLinesByVariant.get(variantId) ?? []);
  for (const optionId of modifierOptionIds) {
    addDemand(demand, catalog.modifierLinesByOption.get(optionId) ?? []);
  }
  return demand;
}

/** Per-unit ingredient demand of one modifier option alone (for its COGS snapshot). */
export function optionDemandPerUnit(catalog: OrderCatalog, optionId: string) {
  return addDemand(new Map<string, number>(), catalog.modifierLinesByOption.get(optionId) ?? []);
}

function addDemand(demand: Map<string, number>, lines: RecipeLineRow[]) {
  for (const line of lines) {
    const quantity = effectiveQuantity(Number(line.quantityBaseUnits), Number(line.wastePercentage ?? 0));
    demand.set(line.ingredientId, (demand.get(line.ingredientId) ?? 0) + quantity);
  }
  return demand;
}
