import { and, asc, count, desc, eq, inArray, or } from "drizzle-orm";
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
  orderLineModifiers,
  orderLines,
  orders,
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
import type { RecipeLineInput } from "@/lib/validation/recipe";
import { effectiveQuantity } from "@/lib/recipes/cost";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";
import { saveRecipe } from "./recipe-service";

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
  const [row] = await db
    .insert(menuCategories)
    .values({ businessId: actor.businessId, name: input.name, displayOrder: input.displayOrder })
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "menu_category.created",
    entityType: "menu_category",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function setCategoryActive(
  db: Database,
  actor: ActorContext,
  id: string,
  active: boolean,
) {
  const [row] = await db
    .update(menuCategories)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(menuCategories.id, id), eq(menuCategories.businessId, actor.businessId)))
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: active ? "menu_category.restored" : "menu_category.archived",
    entityType: "menu_category",
    entityId: id,
    after: row,
  });
  return row;
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
    .leftJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(eq(menuItems.businessId, businessId))
    .orderBy(asc(menuItems.displayOrder), asc(menuItems.name));

  const variants = await db
    .select()
    .from(menuItemVariants)
    .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
    .where(eq(menuItems.businessId, businessId));

  const variantsByItem = new Map<string, (typeof variants)[number]["menu_item_variants"][]>();
  for (const row of variants) {
    const list = variantsByItem.get(row.menu_item_variants.menuItemId) ?? [];
    list.push(row.menu_item_variants);
    variantsByItem.set(row.menu_item_variants.menuItemId, list);
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
    .where(eq(menuItemModifierGroups.menuItemId, id));

  return { item, variants, assignedModifierGroupIds: assignedGroups.map((g) => g.modifierGroupId) };
}

export async function createMenuItem(db: Database, actor: ActorContext, input: MenuItemInput) {
  return db.transaction(async (tx) => {
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
  const [row] = await db
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

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "menu_item.updated",
    entityType: "menu_item",
    entityId: id,
    after: row,
  });
  return row;
}

/** Archive/restore, never a hard delete — historical orders reference menu items by id. */
export async function setMenuItemActive(
  db: Database,
  actor: ActorContext,
  id: string,
  active: boolean,
) {
  const [row] = await db
    .update(menuItems)
    .set({ active, archivedAt: active ? null : new Date(), updatedBy: actor.userId, updatedAt: new Date() })
    .where(and(eq(menuItems.id, id), eq(menuItems.businessId, actor.businessId)))
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: active ? "menu_item.restored" : "menu_item.archived",
    entityType: "menu_item",
    entityId: id,
    after: row,
  });
  return row;
}

async function assertItemBelongsToBusiness(db: Database, businessId: string, menuItemId: string) {
  const [item] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.id, menuItemId), eq(menuItems.businessId, businessId)))
    .limit(1);
  if (!item) throw new Error("Menu item not found");
}

export async function createVariant(
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
  await assertItemBelongsToBusiness(db, actor.businessId, menuItemId);
  const [row] = await db
    .update(menuItemVariants)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(menuItemVariants.id, variantId), eq(menuItemVariants.menuItemId, menuItemId)))
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "menu_item_variant.updated",
    entityType: "menu_item_variant",
    entityId: variantId,
    after: row,
    metadata: { menuItemId },
  });
  return row;
}

export async function setVariantActive(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  variantId: string,
  active: boolean,
) {
  await assertItemBelongsToBusiness(db, actor.businessId, menuItemId);
  const [row] = await db
    .update(menuItemVariants)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(menuItemVariants.id, variantId), eq(menuItemVariants.menuItemId, menuItemId)))
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: active ? "menu_item_variant.restored" : "menu_item_variant.archived",
    entityType: "menu_item_variant",
    entityId: variantId,
    after: row,
    metadata: { menuItemId },
  });
  return row;
}

// ---------------------------------------------------------------------------
// Modifier groups + options
// ---------------------------------------------------------------------------

export async function listModifierGroupsWithOptions(db: Database, businessId: string) {
  const groups = await db
    .select()
    .from(modifierGroups)
    .where(eq(modifierGroups.businessId, businessId))
    .orderBy(asc(modifierGroups.name));

  const options = await db
    .select()
    .from(modifierOptions)
    .innerJoin(modifierGroups, eq(modifierOptions.modifierGroupId, modifierGroups.id))
    .where(eq(modifierGroups.businessId, businessId));

  const optionsByGroup = new Map<string, (typeof options)[number]["modifier_options"][]>();
  for (const row of options) {
    const list = optionsByGroup.get(row.modifier_options.modifierGroupId) ?? [];
    list.push(row.modifier_options);
    optionsByGroup.set(row.modifier_options.modifierGroupId, list);
  }

  return groups.map((group) => ({
    ...group,
    options: (optionsByGroup.get(group.id) ?? []).sort((a, b) => a.displayOrder - b.displayOrder),
  }));
}

export async function createModifierGroup(db: Database, actor: ActorContext, input: ModifierGroupInput) {
  const [row] = await db
    .insert(modifierGroups)
    .values({ businessId: actor.businessId, ...input })
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "modifier_group.created",
    entityType: "modifier_group",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function setModifierGroupActive(
  db: Database,
  actor: ActorContext,
  id: string,
  active: boolean,
) {
  const [row] = await db
    .update(modifierGroups)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(modifierGroups.id, id), eq(modifierGroups.businessId, actor.businessId)))
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: active ? "modifier_group.restored" : "modifier_group.archived",
    entityType: "modifier_group",
    entityId: id,
    after: row,
  });
  return row;
}

async function assertGroupBelongsToBusiness(db: Database, businessId: string, groupId: string) {
  const [group] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.businessId, businessId)))
    .limit(1);
  if (!group) throw new Error("Modifier group not found");
}

export async function createModifierOption(
  db: Database,
  actor: ActorContext,
  groupId: string,
  input: ModifierOptionInput,
) {
  await assertGroupBelongsToBusiness(db, actor.businessId, groupId);
  const [row] = await db
    .insert(modifierOptions)
    .values({ modifierGroupId: groupId, ...input })
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "modifier_option.created",
    entityType: "modifier_option",
    entityId: row.id,
    after: row,
    metadata: { groupId },
  });
  return row;
}

export async function setModifierOptionActive(
  db: Database,
  actor: ActorContext,
  groupId: string,
  optionId: string,
  active: boolean,
) {
  await assertGroupBelongsToBusiness(db, actor.businessId, groupId);
  const [row] = await db
    .update(modifierOptions)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(modifierOptions.id, optionId), eq(modifierOptions.modifierGroupId, groupId)))
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: active ? "modifier_option.restored" : "modifier_option.archived",
    entityType: "modifier_option",
    entityId: optionId,
    after: row,
    metadata: { groupId },
  });
  return row;
}

// ---------------------------------------------------------------------------
// Permanent deletes
// ---------------------------------------------------------------------------

/**
 * Permanent delete is only ever allowed for menu rows that were never sold.
 *
 * An order keeps its own name/price/COGS snapshots (PRD rule 8), so a
 * delete can never change what an old receipt says. But
 * `order_lines.menu_item_id` is ON DELETE SET NULL and
 * `getSalesByCategory` reaches the category by joining order_lines ->
 * menu_items -> menu_categories, so deleting a *sold* item would silently
 * move its past revenue into "Uncategorized" with no way to get it back.
 * Archive is the answer for anything with sales history; delete is for
 * typos, duplicates, and test rows.
 *
 * Each guard below throws a message written for the person who clicked the
 * button — `ToastForm` shows `error.message` verbatim as the failure toast.
 */
function orderLineCount(n: number) {
  return n === 1 ? "1 order line" : `${n} order lines`;
}

async function countSoldOrderLines(db: Database, menuItemId: string, variantIds: string[]) {
  const byItem = eq(orderLines.menuItemId, menuItemId);
  const [row] = await db
    .select({ total: count() })
    .from(orderLines)
    .where(
      variantIds.length > 0 ? or(byItem, inArray(orderLines.menuItemVariantId, variantIds)) : byItem,
    );
  return row?.total ?? 0;
}

async function countSoldModifiers(db: Database, optionIds: string[]) {
  if (optionIds.length === 0) return 0;
  const [row] = await db
    .select({ total: count() })
    .from(orderLineModifiers)
    .where(inArray(orderLineModifiers.modifierOptionId, optionIds));
  return row?.total ?? 0;
}

/**
 * Ids of the items and variants that appear on at least one order line, so
 * the menu UI can show a Delete button as unavailable before it is clicked
 * rather than only failing on submit.
 */
export async function getSoldMenuReferences(db: Database, businessId: string) {
  const rows = await db
    .selectDistinct({ menuItemId: orderLines.menuItemId, variantId: orderLines.menuItemVariantId })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .where(eq(orders.businessId, businessId));

  const soldItemIds = new Set<string>();
  const soldVariantIds = new Set<string>();
  for (const row of rows) {
    if (row.menuItemId) soldItemIds.add(row.menuItemId);
    if (row.variantId) soldVariantIds.add(row.variantId);
  }
  return { soldItemIds: [...soldItemIds], soldVariantIds: [...soldVariantIds] };
}

/**
 * Deletes the item and everything hanging off it — variants, their recipe
 * versions and recipe lines, and its modifier-group assignments — via the
 * schema's ON DELETE CASCADE. Refused once the item has been sold.
 */
export async function deleteMenuItem(db: Database, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.id, id), eq(menuItems.businessId, actor.businessId)))
      .limit(1);
    if (!item) throw new Error("Menu item not found");

    const variants = await tx
      .select({ id: menuItemVariants.id })
      .from(menuItemVariants)
      .where(eq(menuItemVariants.menuItemId, id));

    const sold = await countSoldOrderLines(
      tx,
      id,
      variants.map((v) => v.id),
    );
    if (sold > 0) {
      throw new Error(
        `"${item.name}" appears on ${orderLineCount(sold)} already, so deleting it would distort past sales reports. Archive it instead — it leaves the POS but keeps its sales history.`,
      );
    }

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
      metadata: { deletedVariantCount: variants.length },
    });
    return item;
  });
}

/**
 * Refused for a variant that has been sold, and for an item's last
 * remaining variant — recipes hang off variants (see `createMenuItem`), so
 * an item with none can never be costed or sold again.
 */
export async function deleteVariant(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  variantId: string,
) {
  await assertItemBelongsToBusiness(db, actor.businessId, menuItemId);
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .select()
      .from(menuItemVariants)
      .where(and(eq(menuItemVariants.id, variantId), eq(menuItemVariants.menuItemId, menuItemId)))
      .limit(1);
    if (!variant) throw new Error("Variant not found");

    const [variantTally] = await tx
      .select({ total: count() })
      .from(menuItemVariants)
      .where(eq(menuItemVariants.menuItemId, menuItemId));
    if ((variantTally?.total ?? 0) <= 1) {
      throw new Error(
        "This is the only variant on this item, and every item needs at least one to hold its price and recipe. Add another variant first, or delete the whole item.",
      );
    }

    const [soldTally] = await tx
      .select({ total: count() })
      .from(orderLines)
      .where(eq(orderLines.menuItemVariantId, variantId));
    const sold = soldTally?.total ?? 0;
    if (sold > 0) {
      throw new Error(
        `"${variant.name}" appears on ${orderLineCount(sold)} already, so deleting it would distort past sales reports. Archive it instead.`,
      );
    }

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
 * Refused while any menu item still points at the category — archived ones
 * included, since those are exactly the rows a category sales report
 * reaches through. Move or delete those items first.
 */
export async function deleteCategory(db: Database, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [category] = await tx
      .select()
      .from(menuCategories)
      .where(and(eq(menuCategories.id, id), eq(menuCategories.businessId, actor.businessId)))
      .limit(1);
    if (!category) throw new Error("Category not found");

    const [tally] = await tx
      .select({ total: count() })
      .from(menuItems)
      .where(and(eq(menuItems.categoryId, id), eq(menuItems.businessId, actor.businessId)));
    const itemCount = tally?.total ?? 0;
    if (itemCount > 0) {
      throw new Error(
        `"${category.name}" still holds ${itemCount} menu item${itemCount === 1 ? "" : "s"} (archived ones included). Move them to another category first, or archive this one.`,
      );
    }

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
 * Deletes the group, its options, their modifier recipe lines, and its
 * assignments to menu items (all ON DELETE CASCADE). Refused once any of
 * its options has been chosen on an order.
 */
export async function deleteModifierGroup(db: Database, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [group] = await tx
      .select()
      .from(modifierGroups)
      .where(and(eq(modifierGroups.id, id), eq(modifierGroups.businessId, actor.businessId)))
      .limit(1);
    if (!group) throw new Error("Modifier group not found");

    const options = await tx
      .select({ id: modifierOptions.id })
      .from(modifierOptions)
      .where(eq(modifierOptions.modifierGroupId, id));

    const sold = await countSoldModifiers(
      tx,
      options.map((o) => o.id),
    );
    if (sold > 0) {
      throw new Error(
        `Options in "${group.name}" were chosen on ${orderLineCount(sold)} already, so deleting the group would distort past sales reports. Archive it instead.`,
      );
    }

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
      metadata: { deletedOptionCount: options.length },
    });
    return group;
  });
}

/** Refused once the option has been chosen on an order. */
export async function deleteModifierOption(
  db: Database,
  actor: ActorContext,
  groupId: string,
  optionId: string,
) {
  await assertGroupBelongsToBusiness(db, actor.businessId, groupId);
  return db.transaction(async (tx) => {
    const [option] = await tx
      .select()
      .from(modifierOptions)
      .where(and(eq(modifierOptions.id, optionId), eq(modifierOptions.modifierGroupId, groupId)))
      .limit(1);
    if (!option) throw new Error("Modifier option not found");

    const sold = await countSoldModifiers(tx, [optionId]);
    if (sold > 0) {
      throw new Error(
        `"${option.name}" was chosen on ${orderLineCount(sold)} already, so deleting it would distort past sales reports. Archive it instead.`,
      );
    }

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

export async function getPosMenu(
  db: Database,
  businessId: string,
  opts: { allowNegativeStock: boolean },
): Promise<{ categories: PosCategory[]; items: PosMenuItem[] }> {
  const categories = await db
    .select({ id: menuCategories.id, name: menuCategories.name })
    .from(menuCategories)
    .where(and(eq(menuCategories.businessId, businessId), eq(menuCategories.active, true)))
    .orderBy(asc(menuCategories.displayOrder), asc(menuCategories.name));

  const items = await db
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
    .orderBy(asc(menuItems.displayOrder), asc(menuItems.name));

  const variants = await db
    .select({
      id: menuItemVariants.id,
      name: menuItemVariants.name,
      price: menuItemVariants.price,
      menuItemId: menuItemVariants.menuItemId,
    })
    .from(menuItemVariants)
    .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
    .where(and(eq(menuItems.businessId, businessId), eq(menuItemVariants.active, true)));

  const assignments = await db
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
    .innerJoin(menuItems, eq(menuItemModifierGroups.menuItemId, menuItems.id))
    .where(and(eq(menuItems.businessId, businessId), eq(modifierGroups.active, true)));

  const groupIds = [...new Set(assignments.map((a) => a.groupId))];
  const options =
    groupIds.length > 0
      ? await db
          .select({
            id: modifierOptions.id,
            name: modifierOptions.name,
            priceAdjustment: modifierOptions.priceAdjustment,
            modifierGroupId: modifierOptions.modifierGroupId,
          })
          .from(modifierOptions)
          .where(and(inArray(modifierOptions.modifierGroupId, groupIds), eq(modifierOptions.active, true)))
      : [];

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

  // --- Stock availability (PRD §6.5/§7.8) ---------------------------------
  // Mirrors the submit-time gate in order-service.ts: skipped entirely when
  // the business allows negative stock (nothing to warn the cashier about
  // ahead of time), and — per variant/option, since that's what's actually
  // gated at submit time — skipped for items with tracksInventory off,
  // since no consumption (and therefore no stock check) happens for those
  // either way.
  const variantAvailability = new Map<string, boolean>();
  const optionAvailability = new Map<string, boolean>();

  if (!opts.allowNegativeStock) {
    const variantIds = variants.map((v) => v.id);
    if (variantIds.length > 0) {
      const activeRecipes = await db
        .select({ id: recipes.id, variantId: recipes.menuItemVariantId, version: recipes.version })
        .from(recipes)
        .where(and(inArray(recipes.menuItemVariantId, variantIds), eq(recipes.active, true)))
        .orderBy(desc(recipes.version));

      // Keep only the latest active recipe per variant (a variant can only
      // have one, but this is defensive in case of a data anomaly).
      const recipeIdToVariantId = new Map<string, string>();
      const seenVariant = new Set<string>();
      for (const r of activeRecipes) {
        if (seenVariant.has(r.variantId)) continue;
        seenVariant.add(r.variantId);
        recipeIdToVariantId.set(r.id, r.variantId);
      }

      const recipeIds = [...recipeIdToVariantId.keys()];
      const lines =
        recipeIds.length > 0
          ? await db
              .select({
                recipeId: recipeLines.recipeId,
                quantityBaseUnits: recipeLines.quantityBaseUnits,
                wastePercentage: recipeLines.wastePercentage,
                currentQuantityBaseUnits: ingredients.currentQuantityBaseUnits,
              })
              .from(recipeLines)
              .innerJoin(ingredients, eq(recipeLines.ingredientId, ingredients.id))
              .where(inArray(recipeLines.recipeId, recipeIds))
          : [];

      for (const line of lines) {
        const variantId = recipeIdToVariantId.get(line.recipeId);
        if (!variantId) continue;
        const needed = effectiveQuantity(Number(line.quantityBaseUnits), Number(line.wastePercentage ?? 0));
        if (needed > Number(line.currentQuantityBaseUnits)) {
          variantAvailability.set(variantId, false);
        }
      }
    }

    const optionIds = options.map((o) => o.id);
    if (optionIds.length > 0) {
      const modLines = await db
        .select({
          modifierOptionId: modifierRecipeLines.modifierOptionId,
          quantityBaseUnits: modifierRecipeLines.quantityBaseUnits,
          wastePercentage: modifierRecipeLines.wastePercentage,
          currentQuantityBaseUnits: ingredients.currentQuantityBaseUnits,
        })
        .from(modifierRecipeLines)
        .innerJoin(ingredients, eq(modifierRecipeLines.ingredientId, ingredients.id))
        .where(inArray(modifierRecipeLines.modifierOptionId, optionIds));

      for (const line of modLines) {
        const needed = effectiveQuantity(Number(line.quantityBaseUnits), Number(line.wastePercentage ?? 0));
        if (needed > Number(line.currentQuantityBaseUnits)) {
          optionAvailability.set(line.modifierOptionId, false);
        }
      }
    }
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

export async function setItemModifierGroups(
  db: Database,
  actor: ActorContext,
  menuItemId: string,
  modifierGroupIds: string[],
) {
  await assertItemBelongsToBusiness(db, actor.businessId, menuItemId);

  await db.transaction(async (tx) => {
    await tx.delete(menuItemModifierGroups).where(eq(menuItemModifierGroups.menuItemId, menuItemId));
    if (modifierGroupIds.length > 0) {
      await tx.insert(menuItemModifierGroups).values(
        modifierGroupIds.map((modifierGroupId, index) => ({
          menuItemId,
          modifierGroupId,
          displayOrder: index,
        })),
      );
    }
  });

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "menu_item.modifier_groups_updated",
    entityType: "menu_item",
    entityId: menuItemId,
    metadata: { modifierGroupIds },
  });
}
