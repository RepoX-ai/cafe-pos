import { and, asc, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  ingredients,
  menuCategories,
  menuItemModifierGroups,
  menuItems,
  menuItemVariants,
  modifierGroups,
  modifierOptions,
  modifierRecipeLines,
  recipeLines,
  recipes,
} from "@/lib/db/schema";
import type {
  CategoryInput,
  MenuItemInput,
  ModifierGroupInput,
  ModifierOptionInput,
  VariantInput,
} from "@/lib/validation/menu";
import type { ModifierRecipeInput, RecipeLineInput } from "@/lib/validation/recipe";
import { calculateRecipeCost, effectiveQuantity } from "@/lib/recipes/cost";
import { recordAuditLog } from "./audit";
import { NotFoundError, ServiceError } from "./errors";
import type { ActorContext } from "./ingredient-service";
import { lockModifierOptionForRecipe } from "./locks";
import { saveRecipe } from "./recipe-service";

/** Upper bound on modifier groups assigned to one item (also enforced by the action's input schema). */
export const MAX_MODIFIER_GROUPS_PER_ITEM = 50;

async function assertCategoryInBusiness(db: Database, businessId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const [row] = await db
    .select({ id: menuCategories.id })
    .from(menuCategories)
    .where(and(eq(menuCategories.id, categoryId), eq(menuCategories.businessId, businessId)))
    .limit(1);
  if (!row) throw new NotFoundError("Category not found");
}

/**
 * Current photo per menu item, for decorating report widgets. Photos are not
 * part of the order snapshot, so a deleted item simply has none.
 */
export async function getMenuItemImages(db: Database, businessId: string, menuItemIds: string[]) {
  if (menuItemIds.length === 0) return new Map<string, string | null>();
  const rows = await db
    .select({ id: menuItems.id, imageUrl: menuItems.imageUrl })
    .from(menuItems)
    .where(and(eq(menuItems.businessId, businessId), inArray(menuItems.id, menuItemIds)));
  return new Map(rows.map((r) => [r.id, r.imageUrl]));
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(db: Database, businessId: string) {
  return db
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.businessId, businessId))
    .orderBy(asc(menuCategories.displayOrder), asc(menuCategories.name));
}

export async function createCategory(db: Database, actor: ActorContext, input: CategoryInput) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(menuCategories)
      .values({ businessId: actor.businessId, name: input.name, displayOrder: input.displayOrder })
      .returning();
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_category.created",
      entityType: "menu_category",
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

export async function setCategoryActive(
  db: Database,
  actor: ActorContext,
  id: string,
  active: boolean,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(menuCategories)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(menuCategories.id, id), eq(menuCategories.businessId, actor.businessId)))
      .returning();
    if (!row) throw new NotFoundError("Category not found");
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: active ? "menu_category.restored" : "menu_category.archived",
      entityType: "menu_category",
      entityId: id,
      after: row,
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Menu items + variants
// ---------------------------------------------------------------------------

export async function listMenuItemsWithVariants(db: Database, businessId: string) {
  const items = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      description: menuItems.description,
      categoryId: menuItems.categoryId,
      categoryName: menuCategories.name,
      imageUrl: menuItems.imageUrl,
      basePrice: menuItems.basePrice,
      active: menuItems.active,
      tracksInventory: menuItems.tracksInventory,
      displayOrder: menuItems.displayOrder,
    })
    .from(menuItems)
    .leftJoin(menuCategories, and(eq(menuItems.categoryId, menuCategories.id), eq(menuCategories.businessId, businessId)))
    .where(eq(menuItems.businessId, businessId))
    .orderBy(asc(menuItems.displayOrder), asc(menuItems.name));

  // Only the variant's own columns come back; the join is just the tenant filter.
  const variants = await db
    .select(getTableColumns(menuItemVariants))
    .from(menuItemVariants)
    .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
    .where(eq(menuItems.businessId, businessId));

  const variantsByItem = new Map<string, (typeof variants)[number][]>();
  for (const row of variants) {
    const list = variantsByItem.get(row.menuItemId) ?? [];
    list.push(row);
    variantsByItem.set(row.menuItemId, list);
  }

  return items.map((item) => ({
    ...item,
    variants: (variantsByItem.get(item.id) ?? []).sort((a, b) => a.displayOrder - b.displayOrder),
  }));
}

export async function getMenuItemById(db: Database, businessId: string, id: string) {
  const [item] = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.id, id), eq(menuItems.businessId, businessId)))
    .limit(1);
  if (!item) return null;

  const variants = await db
    .select()
    .from(menuItemVariants)
    .where(eq(menuItemVariants.menuItemId, id))
    .orderBy(asc(menuItemVariants.displayOrder), asc(menuItemVariants.name));

  const assignedGroups = await db
    .select({ modifierGroupId: menuItemModifierGroups.modifierGroupId })
    .from(menuItemModifierGroups)
    .where(and(eq(menuItemModifierGroups.menuItemId, id), eq(menuItemModifierGroups.businessId, businessId)))
    .orderBy(asc(menuItemModifierGroups.displayOrder));

  return { item, variants, assignedModifierGroupIds: assignedGroups.map((g) => g.modifierGroupId) };
}

export async function createMenuItem(db: Database, actor: ActorContext, input: MenuItemInput) {
  return db.transaction(async (tx) => {
    await assertCategoryInBusiness(tx, actor.businessId, input.categoryId);
    const [row] = await tx
      .insert(menuItems)
      .values({
        businessId: actor.businessId,
        categoryId: input.categoryId || null,
        name: input.name,
        description: input.description || null,
        imageUrl: input.imageUrl || null,
        basePrice: input.basePrice,
        taxBehavior: input.taxBehavior,
        tracksInventory: input.tracksInventory,
        active: input.active,
        displayOrder: input.displayOrder,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_item.created",
      entityType: "menu_item",
      entityId: row.id,
      after: row,
    });

    // Recipes (and therefore stock deduction/COGS) are keyed to a variant,
    // not a menu item — an item with no variant at all can never have one.
    // Every item gets a default "Regular" variant seeded from basePrice so
    // it always has somewhere to hang a recipe, even if the owner never
    // adds a second size. This mirrors what scripts/seed.ts already does
    // by hand for its sample menu.
    const [defaultVariant] = await tx
      .insert(menuItemVariants)
      .values({ menuItemId: row.id, name: "Regular", price: input.basePrice })
      .returning();

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_item_variant.created",
      entityType: "menu_item_variant",
      entityId: defaultVariant.id,
      after: defaultVariant,
      metadata: { menuItemId: row.id, autoCreated: true },
    });

    return row;
  });
}

/**
 * `basePrice` is only ever an input again on this path via a hidden field
 * carrying the item's current value through unchanged — the item edit form
 * no longer exposes it for editing (see item-detail-client.tsx). Price is a
 * per-variant thing now that every item always has at least one variant
 * (see createMenuItem); basePrice's only real job is seeding that first
 * variant's price at creation time.
 */
export async function updateMenuItem(
  db: Database,
  actor: ActorContext,
  id: string,
  input: MenuItemInput,
) {
  return db.transaction(async (tx) => {
    await assertCategoryInBusiness(tx, actor.businessId, input.categoryId);
    const [row] = await tx
      .update(menuItems)
      .set({
        categoryId: input.categoryId || null,
        name: input.name,
        description: input.description || null,
        imageUrl: input.imageUrl || null,
        basePrice: input.basePrice,
        taxBehavior: input.taxBehavior,
        tracksInventory: input.tracksInventory,
        active: input.active,
        displayOrder: input.displayOrder,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(menuItems.id, id), eq(menuItems.businessId, actor.businessId)))
      .returning();
    if (!row) throw new NotFoundError("Menu item not found");

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_item.updated",
      entityType: "menu_item",
      entityId: id,
      after: row,
    });
    return row;
  });
}

/** Archive/restore, never a hard delete — historical orders reference menu items by id. */
export async function setMenuItemActive(
  db: Database,
  actor: ActorContext,
  id: string,
  active: boolean,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(menuItems)
      .set({ active, archivedAt: active ? null : new Date(), updatedBy: actor.userId, updatedAt: new Date() })
      .where(and(eq(menuItems.id, id), eq(menuItems.businessId, actor.businessId)))
      .returning();
    if (!row) throw new NotFoundError("Menu item not found");

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: active ? "menu_item.restored" : "menu_item.archived",
      entityType: "menu_item",
      entityId: id,
      after: row,
    });
    return row;
  });
}

async function assertItemBelongsToBusiness(db: Database, businessId: string, menuItemId: string) {
  const [item] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.id, menuItemId), eq(menuItems.businessId, businessId)))
    .limit(1);
  if (!item) throw new NotFoundError("Menu item not found");
}

async function createVariant(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  input: VariantInput,
) {
  await assertItemBelongsToBusiness(db, actor.businessId, menuItemId);
  const [row] = await db
    .insert(menuItemVariants)
    .values({ menuItemId, ...input })
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "menu_item_variant.created",
    entityType: "menu_item_variant",
    entityId: row.id,
    after: row,
    metadata: { menuItemId },
  });
  return row;
}

/**
 * Creates a variant and, if any ingredient lines were given, its first
 * recipe version in one step — so adding a size doesn't force a separate
 * trip to the recipe page before it can affect stock/COGS. Both writes
 * happen in one transaction; recipeLines may be empty (a variant with no
 * recipe yet, exactly like createVariant on its own).
 */
export async function createVariantWithRecipe(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  variantInput: VariantInput,
  recipeLines: RecipeLineInput[],
) {
  return db.transaction(async (tx) => {
    const variant = await createVariant(tx, actor, menuItemId, variantInput);
    if (recipeLines.length > 0) {
      await saveRecipe(tx, actor, { menuItemVariantId: variant.id, lines: recipeLines });
    }
    return variant;
  });
}

export async function updateVariant(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  variantId: string,
  input: VariantInput,
) {
  return db.transaction(async (tx) => {
    await assertItemBelongsToBusiness(tx, actor.businessId, menuItemId);
    const [row] = await tx
      .update(menuItemVariants)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(menuItemVariants.id, variantId), eq(menuItemVariants.menuItemId, menuItemId)))
      .returning();
    if (!row) throw new NotFoundError("Variant not found");
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_item_variant.updated",
      entityType: "menu_item_variant",
      entityId: variantId,
      after: row,
      metadata: { menuItemId },
    });
    return row;
  });
}

export async function setVariantActive(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  variantId: string,
  active: boolean,
) {
  return db.transaction(async (tx) => {
    await assertItemBelongsToBusiness(tx, actor.businessId, menuItemId);
    const [row] = await tx
      .update(menuItemVariants)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(menuItemVariants.id, variantId), eq(menuItemVariants.menuItemId, menuItemId)))
      .returning();
    if (!row) throw new NotFoundError("Variant not found");
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: active ? "menu_item_variant.restored" : "menu_item_variant.archived",
      entityType: "menu_item_variant",
      entityId: variantId,
      after: row,
      metadata: { menuItemId },
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Modifier groups + options
// ---------------------------------------------------------------------------

export interface ModifierRecipeLineView {
  ingredientId: string;
  quantityBaseUnits: number;
  wastePercentage: number;
}

export async function listModifierGroupsWithOptions(db: Database, businessId: string) {
  const groups = await db
    .select()
    .from(modifierGroups)
    .where(eq(modifierGroups.businessId, businessId))
    .orderBy(asc(modifierGroups.name));

  const options = await db
    .select(getTableColumns(modifierOptions))
    .from(modifierOptions)
    .innerJoin(modifierGroups, eq(modifierOptions.modifierGroupId, modifierGroups.id))
    .where(eq(modifierGroups.businessId, businessId));

  const lines = options.length
    ? await db
        .select({
          modifierOptionId: modifierRecipeLines.modifierOptionId,
          ingredientId: modifierRecipeLines.ingredientId,
          quantityBaseUnits: modifierRecipeLines.quantityBaseUnits,
          wastePercentage: modifierRecipeLines.wastePercentage,
          costPerBaseUnit: ingredients.averageCostPerBaseUnit,
        })
        .from(modifierRecipeLines)
        .innerJoin(ingredients, and(eq(modifierRecipeLines.ingredientId, ingredients.id), eq(ingredients.businessId, businessId)))
        .where(inArray(modifierRecipeLines.modifierOptionId, options.map((o) => o.id)))
    : [];
  const linesByOption = new Map<string, (typeof lines)[number][]>();
  for (const line of lines) {
    const list = linesByOption.get(line.modifierOptionId) ?? [];
    list.push(line);
    linesByOption.set(line.modifierOptionId, list);
  }

  type OptionWithRecipe = (typeof options)[number] & { recipeLines: ModifierRecipeLineView[]; cogs: number };
  const optionsByGroup = new Map<string, OptionWithRecipe[]>();
  for (const row of options) {
    const recipe = (linesByOption.get(row.id) ?? []).map((l) => ({
      ingredientId: l.ingredientId,
      quantityBaseUnits: Number(l.quantityBaseUnits),
      wastePercentage: Number(l.wastePercentage ?? 0),
      costPerBaseUnit: l.costPerBaseUnit,
    }));
    const list = optionsByGroup.get(row.modifierGroupId) ?? [];
    // COGS at today's average cost, as a preview for the admin screen.
    // Orders snapshot their own cost when submitted.
    list.push({
      ...row,
      recipeLines: recipe.map((l) => ({ ingredientId: l.ingredientId, quantityBaseUnits: l.quantityBaseUnits, wastePercentage: l.wastePercentage })),
      cogs: calculateRecipeCost(recipe),
    });
    optionsByGroup.set(row.modifierGroupId, list);
  }

  return groups.map((group) => ({
    ...group,
    options: (optionsByGroup.get(group.id) ?? []).sort((a, b) => a.displayOrder - b.displayOrder),
  }));
}

export async function createModifierGroup(db: Database, actor: ActorContext, input: ModifierGroupInput) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(modifierGroups)
      .values({ businessId: actor.businessId, ...input })
      .returning();
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "modifier_group.created",
      entityType: "modifier_group",
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

export async function setModifierGroupActive(
  db: Database,
  actor: ActorContext,
  id: string,
  active: boolean,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(modifierGroups)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(modifierGroups.id, id), eq(modifierGroups.businessId, actor.businessId)))
      .returning();
    if (!row) throw new NotFoundError("Modifier group not found");
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: active ? "modifier_group.restored" : "modifier_group.archived",
      entityType: "modifier_group",
      entityId: id,
      after: row,
    });
    return row;
  });
}

async function assertGroupBelongsToBusiness(db: Database, businessId: string, groupId: string) {
  const [group] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.businessId, businessId)))
    .limit(1);
  if (!group) throw new NotFoundError("Modifier group not found");
}

export async function createModifierOption(
  db: Database,
  actor: ActorContext,
  groupId: string,
  input: ModifierOptionInput,
) {
  return db.transaction(async (tx) => {
    await assertGroupBelongsToBusiness(tx, actor.businessId, groupId);
    const [row] = await tx
      .insert(modifierOptions)
      .values({ modifierGroupId: groupId, ...input })
      .returning();
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "modifier_option.created",
      entityType: "modifier_option",
      entityId: row.id,
      after: row,
      metadata: { groupId },
    });
    return row;
  });
}

export async function setModifierOptionActive(
  db: Database,
  actor: ActorContext,
  groupId: string,
  optionId: string,
  active: boolean,
) {
  return db.transaction(async (tx) => {
    await assertGroupBelongsToBusiness(tx, actor.businessId, groupId);
    const [row] = await tx
      .update(modifierOptions)
      .set({ active, updatedAt: new Date() })
      .where(and(eq(modifierOptions.id, optionId), eq(modifierOptions.modifierGroupId, groupId)))
      .returning();
    if (!row) throw new NotFoundError("Modifier option not found");
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: active ? "modifier_option.restored" : "modifier_option.archived",
      entityType: "modifier_option",
      entityId: optionId,
      after: row,
      metadata: { groupId },
    });
    return row;
  });
}

/**
 * Replaces an option's ingredient lines. Unlike menu-item recipes these are
 * not versioned: submitted orders already hold their own consumption and
 * COGS snapshots, so a later edit can't change them.
 */
export async function saveModifierOptionRecipe(db: Database, actor: ActorContext, input: ModifierRecipeInput) {
  return db.transaction(async (tx) => {
    // Serializes replacements of the same option's lines. Without it, two
    // concurrent saves each delete only the lines their snapshot could see
    // and both inserts survive — every sale would then consume both sets.
    await lockModifierOptionForRecipe(tx, actor.businessId, input.groupId, input.optionId);

    const ingredientIds = input.lines.map((l) => l.ingredientId);
    if (ingredientIds.length > 0) {
      const rows = await tx
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(and(inArray(ingredients.id, ingredientIds), eq(ingredients.businessId, actor.businessId)));
      if (rows.length !== new Set(ingredientIds).size) {
        throw new ServiceError("One or more ingredients are invalid for this business");
      }
    }

    const before = await tx
      .delete(modifierRecipeLines)
      .where(and(eq(modifierRecipeLines.modifierOptionId, input.optionId), eq(modifierRecipeLines.businessId, actor.businessId)))
      .returning();
    const after = input.lines.length
      ? await tx
          .insert(modifierRecipeLines)
          .values(
            input.lines.map((line) => ({
              businessId: actor.businessId,
              modifierOptionId: input.optionId,
              ingredientId: line.ingredientId,
              quantityBaseUnits: String(line.quantityBaseUnits),
              wastePercentage: String(line.wastePercentage ?? 0),
            })),
          )
          .returning()
      : [];

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "modifier_option.recipe_saved",
      entityType: "modifier_option",
      entityId: input.optionId,
      before,
      after,
      metadata: { groupId: input.groupId },
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Permanent deletes
// ---------------------------------------------------------------------------

/**
 * Menu rows can be deleted outright, sold or not — the owner's explicit
 * call. What makes that safe is that an order never reads the live menu:
 * every order line carries its own item name, variant name, category name,
 * unit price, COGS and gross profit as snapshot columns (PRD rule 8), and
 * `order_lines.menu_item_id` is ON DELETE SET NULL. So a delete drops the
 * link, never the history — receipts, daily totals, sales-by-item and
 * sales-by-category all keep reading exactly what they read before.
 *
 * `category_name_snapshot` exists specifically for this: before it,
 * sales-by-category reached the category by joining through the live
 * menu_items row, so deleting an item silently moved its past revenue to
 * "Uncategorized". Don't reintroduce that join (see
 * `reports-service.getSalesByCategory`), and run
 * `npm run db:backfill-order-line-categories` on any database whose order
 * lines predate the column.
 *
 * The only checks left here are ownership ones — a caller may never touch
 * another business's rows — not policy ones.
 */
export async function deleteMenuItem(db: Database, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.id, id), eq(menuItems.businessId, actor.businessId)))
      .limit(1);
    if (!item) throw new NotFoundError("Menu item not found");

    // Cascades to variants, their recipe versions and recipe lines, and the
    // item's modifier-group assignments.
    await tx
      .delete(menuItems)
      .where(and(eq(menuItems.id, id), eq(menuItems.businessId, actor.businessId)));

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_item.deleted",
      entityType: "menu_item",
      entityId: id,
      before: item,
    });
    return item;
  });
}

export async function deleteVariant(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  variantId: string,
) {
  return db.transaction(async (tx) => {
    await assertItemBelongsToBusiness(tx, actor.businessId, menuItemId);
    const [variant] = await tx
      .select()
      .from(menuItemVariants)
      .where(and(eq(menuItemVariants.id, variantId), eq(menuItemVariants.menuItemId, menuItemId)))
      .limit(1);
    if (!variant) throw new NotFoundError("Variant not found");

    await tx.delete(menuItemVariants).where(eq(menuItemVariants.id, variantId));

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_item_variant.deleted",
      entityType: "menu_item_variant",
      entityId: variantId,
      before: variant,
      metadata: { menuItemId },
    });
    return variant;
  });
}

/**
 * Items in the category are not deleted with it — `menu_items.category_id`
 * is ON DELETE SET NULL, so they survive as uncategorized. Past orders keep
 * the category name they were sold under either way.
 */
export async function deleteCategory(db: Database, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [category] = await tx
      .select()
      .from(menuCategories)
      .where(and(eq(menuCategories.id, id), eq(menuCategories.businessId, actor.businessId)))
      .limit(1);
    if (!category) throw new NotFoundError("Category not found");

    // The same-business foreign key has no ON DELETE action (see the
    // schema), so the items are un-assigned explicitly, in this transaction.
    await tx
      .update(menuItems)
      .set({ categoryId: null, updatedAt: new Date() })
      .where(and(eq(menuItems.businessId, actor.businessId), eq(menuItems.categoryId, id)));

    await tx
      .delete(menuCategories)
      .where(and(eq(menuCategories.id, id), eq(menuCategories.businessId, actor.businessId)));

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_category.deleted",
      entityType: "menu_category",
      entityId: id,
      before: category,
    });
    return category;
  });
}

/**
 * Cascades to the group's options, their modifier recipe lines, and its
 * assignments to menu items. Past order lines keep their own
 * `modifier_name_snapshot` and price/COGS adjustments.
 */
export async function deleteModifierGroup(db: Database, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select()
      .from(modifierGroups)
      .where(and(eq(modifierGroups.id, id), eq(modifierGroups.businessId, actor.businessId)))
      .limit(1);
    if (!group) throw new NotFoundError("Modifier group not found");

    await tx
      .delete(modifierGroups)
      .where(and(eq(modifierGroups.id, id), eq(modifierGroups.businessId, actor.businessId)));

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "modifier_group.deleted",
      entityType: "modifier_group",
      entityId: id,
      before: group,
    });
    return group;
  });
}

export async function deleteModifierOption(
  db: Database,
  actor: ActorContext,
  groupId: string,
  optionId: string,
) {
  return db.transaction(async (tx) => {
    await assertGroupBelongsToBusiness(tx, actor.businessId, groupId);
    const [option] = await tx
      .select()
      .from(modifierOptions)
      .where(and(eq(modifierOptions.id, optionId), eq(modifierOptions.modifierGroupId, groupId)))
      .limit(1);
    if (!option) throw new NotFoundError("Modifier option not found");

    await tx.delete(modifierOptions).where(eq(modifierOptions.id, optionId));

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "modifier_option.deleted",
      entityType: "modifier_option",
      entityId: optionId,
      before: option,
      metadata: { groupId },
    });
    return option;
  });
}

// ---------------------------------------------------------------------------
// POS catalog (active-only, shaped for the order-entry screen)
// ---------------------------------------------------------------------------

export interface PosModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;
  inStock: boolean;
}

export interface PosModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: PosModifierOption[];
}

export interface PosVariant {
  id: string;
  name: string;
  price: number;
  inStock: boolean;
}

export interface PosMenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  // Used to price/sell the item directly when it has no variants.
  basePrice: number;
  variants: PosVariant[];
  modifierGroups: PosModifierGroup[];
  // True only when the item has variants and every one of them is short an
  // ingredient — an item with no variants is always sellable off basePrice
  // (recipes are keyed by menu_item_variant_id, so it never has a recipe).
  outOfStock: boolean;
}

export interface PosCategory {
  id: string;
  name: string;
}

/**
 * The POS catalog, in three dependency stages. Everything inside a stage is
 * independent, so the stages are what actually have to happen in sequence —
 * the reads within one run concurrently instead of queueing behind each
 * other:
 *
 *   1. categories, items, variants, modifier-group assignments — each needs
 *      only `businessId` (variants and assignments join `menu_items`
 *      themselves rather than waiting for the item list)
 *   2. modifier options (needs the group ids), active recipes (needs the
 *      variant ids)
 *   3. recipe lines (needs the recipe ids), modifier recipe lines (needs the
 *      option ids)
 *
 * Every read stays one batched statement over an id list — no per-item,
 * per-variant or per-ingredient queries — so the widest stage takes four
 * connections, which fits the default pool (DATABASE_POOL_MAX=5) without
 * starving the rest of the request.
 */
export async function getPosMenu(
  db: Database,
  businessId: string,
  opts: { allowNegativeStock: boolean },
): Promise<{ categories: PosCategory[]; items: PosMenuItem[] }> {
  // Stock availability (PRD §6.5/§7.8) mirrors the submit-time gate in
  // order-service.ts: skipped entirely when the business allows negative
  // stock (nothing to warn the cashier about ahead of time), and — per
  // variant/option, since that's what's actually gated at submit time —
  // skipped for items with tracksInventory off, since no consumption (and
  // therefore no stock check) happens for those either way.
  const checkStock = !opts.allowNegativeStock;

  // --- Stage 1: independent, tenant-scoped reads --------------------------
  const [categories, items, variants, assignments] = await Promise.all([
    db
      .select({ id: menuCategories.id, name: menuCategories.name })
      .from(menuCategories)
      .where(and(eq(menuCategories.businessId, businessId), eq(menuCategories.active, true)))
      .orderBy(asc(menuCategories.displayOrder), asc(menuCategories.name)),

    db
      .select({
        id: menuItems.id,
        name: menuItems.name,
        description: menuItems.description,
        imageUrl: menuItems.imageUrl,
        categoryId: menuItems.categoryId,
        basePrice: menuItems.basePrice,
        tracksInventory: menuItems.tracksInventory,
      })
      .from(menuItems)
      .where(and(eq(menuItems.businessId, businessId), eq(menuItems.active, true)))
      .orderBy(asc(menuItems.displayOrder), asc(menuItems.name)),

    db
      .select({
        id: menuItemVariants.id,
        name: menuItemVariants.name,
        price: menuItemVariants.price,
        menuItemId: menuItemVariants.menuItemId,
      })
      .from(menuItemVariants)
      .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
      .where(and(eq(menuItems.businessId, businessId), eq(menuItemVariants.active, true))),

    db
      .select({
        menuItemId: menuItemModifierGroups.menuItemId,
        groupId: modifierGroups.id,
        groupName: modifierGroups.name,
        required: modifierGroups.required,
        minSelections: modifierGroups.minSelections,
        maxSelections: modifierGroups.maxSelections,
      })
      .from(menuItemModifierGroups)
      .innerJoin(modifierGroups, eq(menuItemModifierGroups.modifierGroupId, modifierGroups.id))
      .where(
        and(
          eq(menuItemModifierGroups.businessId, businessId),
          eq(modifierGroups.businessId, businessId),
          eq(modifierGroups.active, true),
        ),
      )
      .orderBy(asc(menuItemModifierGroups.displayOrder)),
  ]);

  // --- Stage 2: one id list each from stage 1 -----------------------------
  const groupIds = [...new Set(assignments.map((a) => a.groupId))];
  const variantIds = variants.map((v) => v.id);

  const [options, activeRecipes] = await Promise.all([
    groupIds.length > 0
      ? db
          .select({
            id: modifierOptions.id,
            name: modifierOptions.name,
            priceAdjustment: modifierOptions.priceAdjustment,
            modifierGroupId: modifierOptions.modifierGroupId,
          })
          .from(modifierOptions)
          .where(and(inArray(modifierOptions.modifierGroupId, groupIds), eq(modifierOptions.active, true)))
      : [],

    checkStock && variantIds.length > 0
      ? db
          .select({ id: recipes.id, variantId: recipes.menuItemVariantId, version: recipes.version })
          .from(recipes)
          .where(and(inArray(recipes.menuItemVariantId, variantIds), eq(recipes.active, true)))
          .orderBy(desc(recipes.version))
      : [],
  ]);

  // Keep only the latest active recipe per variant (a variant can only have
  // one, but this is defensive in case of a data anomaly).
  const recipeIdToVariantId = new Map<string, string>();
  const seenVariant = new Set<string>();
  for (const r of activeRecipes) {
    if (seenVariant.has(r.variantId)) continue;
    seenVariant.add(r.variantId);
    recipeIdToVariantId.set(r.id, r.variantId);
  }
  const recipeIds = [...recipeIdToVariantId.keys()];
  const optionIds = options.map((o) => o.id);

  // --- Stage 3: the availability reads, each keyed by a stage-2 id list ---
  const [lines, modLines] = await Promise.all([
    recipeIds.length > 0
      ? db
          .select({
            recipeId: recipeLines.recipeId,
            quantityBaseUnits: recipeLines.quantityBaseUnits,
            wastePercentage: recipeLines.wastePercentage,
            currentQuantityBaseUnits: ingredients.currentQuantityBaseUnits,
          })
          .from(recipeLines)
          .innerJoin(ingredients, and(eq(recipeLines.ingredientId, ingredients.id), eq(ingredients.businessId, businessId)))
          .where(inArray(recipeLines.recipeId, recipeIds))
      : [],

    checkStock && optionIds.length > 0
      ? db
          .select({
            modifierOptionId: modifierRecipeLines.modifierOptionId,
            quantityBaseUnits: modifierRecipeLines.quantityBaseUnits,
            wastePercentage: modifierRecipeLines.wastePercentage,
            currentQuantityBaseUnits: ingredients.currentQuantityBaseUnits,
          })
          .from(modifierRecipeLines)
          .innerJoin(ingredients, and(eq(modifierRecipeLines.ingredientId, ingredients.id), eq(ingredients.businessId, businessId)))
          .where(inArray(modifierRecipeLines.modifierOptionId, optionIds))
      : [],
  ]);

  const variantAvailability = new Map<string, boolean>();
  for (const line of lines) {
    const variantId = recipeIdToVariantId.get(line.recipeId);
    if (!variantId) continue;
    const needed = effectiveQuantity(Number(line.quantityBaseUnits), Number(line.wastePercentage ?? 0));
    if (needed > Number(line.currentQuantityBaseUnits)) {
      variantAvailability.set(variantId, false);
    }
  }

  const optionAvailability = new Map<string, boolean>();
  for (const line of modLines) {
    const needed = effectiveQuantity(Number(line.quantityBaseUnits), Number(line.wastePercentage ?? 0));
    if (needed > Number(line.currentQuantityBaseUnits)) {
      optionAvailability.set(line.modifierOptionId, false);
    }
  }

  const variantsByItem = new Map<string, PosVariant[]>();
  for (const v of variants) {
    const list = variantsByItem.get(v.menuItemId) ?? [];
    list.push({ id: v.id, name: v.name, price: v.price, inStock: true });
    variantsByItem.set(v.menuItemId, list);
  }

  const optionsByGroup = new Map<string, PosModifierOption[]>();
  for (const o of options) {
    const list = optionsByGroup.get(o.modifierGroupId) ?? [];
    list.push({ id: o.id, name: o.name, priceAdjustment: o.priceAdjustment, inStock: true });
    optionsByGroup.set(o.modifierGroupId, list);
  }

  const groupsByItem = new Map<string, PosModifierGroup[]>();
  for (const a of assignments) {
    const list = groupsByItem.get(a.menuItemId) ?? [];
    list.push({
      id: a.groupId,
      name: a.groupName,
      required: a.required,
      minSelections: a.minSelections,
      maxSelections: a.maxSelections,
      options: optionsByGroup.get(a.groupId) ?? [],
    });
    groupsByItem.set(a.menuItemId, list);
  }

  // Items with no active variant are still orderable — sold directly off
  // their basePrice (see order-service.submitOrder).
  const posItems: PosMenuItem[] = items.map((item) => {
    const itemVariants = (variantsByItem.get(item.id) ?? []).map((v) => ({
      ...v,
      inStock: item.tracksInventory ? (variantAvailability.get(v.id) ?? true) : true,
    }));
    const itemModifierGroups = (groupsByItem.get(item.id) ?? []).map((g) => ({
      ...g,
      options: g.options.map((o) => ({
        ...o,
        inStock: item.tracksInventory ? (optionAvailability.get(o.id) ?? true) : true,
      })),
    }));

    return {
      id: item.id,
      name: item.name,
      description: item.description,
      imageUrl: item.imageUrl,
      categoryId: item.categoryId,
      basePrice: item.basePrice,
      variants: itemVariants,
      modifierGroups: itemModifierGroups,
      outOfStock: itemVariants.length > 0 && itemVariants.every((v) => !v.inStock),
    };
  });

  return { categories, items: posItems };
}

/**
 * Replaces the modifier groups assigned to an item. Every group must belong
 * to the caller's business — checked here, and enforced again by the
 * same-business foreign keys on `menu_item_modifier_groups`. The item row
 * is locked first so two concurrent replacements run one after the other
 * instead of interleaving their delete and insert.
 */
export async function setItemModifierGroups(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  modifierGroupIds: string[],
) {
  const groupIds = [...new Set(modifierGroupIds)];
  if (groupIds.length > MAX_MODIFIER_GROUPS_PER_ITEM) {
    throw new ServiceError(`An item can have at most ${MAX_MODIFIER_GROUPS_PER_ITEM} modifier groups.`);
  }

  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.id, menuItemId), eq(menuItems.businessId, actor.businessId)))
      .for("update");
    if (!item) throw new NotFoundError("Menu item not found");

    if (groupIds.length > 0) {
      const owned = await tx
        .select({ id: modifierGroups.id })
        .from(modifierGroups)
        .where(and(inArray(modifierGroups.id, groupIds), eq(modifierGroups.businessId, actor.businessId)));
      if (owned.length !== groupIds.length) throw new NotFoundError("Modifier group not found");
    }

    await tx
      .delete(menuItemModifierGroups)
      .where(and(eq(menuItemModifierGroups.menuItemId, menuItemId), eq(menuItemModifierGroups.businessId, actor.businessId)));
    if (groupIds.length > 0) {
      await tx.insert(menuItemModifierGroups).values(
        groupIds.map((modifierGroupId, index) => ({
          businessId: actor.businessId,
          menuItemId,
          modifierGroupId,
          displayOrder: index,
        })),
      );
    }

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "menu_item.modifier_groups_updated",
      entityType: "menu_item",
      entityId: menuItemId,
      metadata: { modifierGroupIds: groupIds },
    });
  });
}
