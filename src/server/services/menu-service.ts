import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  menuCategories,
  menuItemModifierGroups,
  menuItems,
  menuItemVariants,
  modifierGroups,
  modifierOptions,
} from "@/lib/db/schema";
import type {
  CategoryInput,
  MenuItemInput,
  ModifierGroupInput,
  ModifierOptionInput,
  VariantInput,
} from "@/lib/validation/menu";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

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

export async function updateCategory(
  db: Database,
  actor: ActorContext,
  id: string,
  input: CategoryInput,
) {
  const [row] = await db
    .update(menuCategories)
    .set({ name: input.name, displayOrder: input.displayOrder, updatedAt: new Date() })
    .where(and(eq(menuCategories.id, id), eq(menuCategories.businessId, actor.businessId)))
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "menu_category.updated",
    entityType: "menu_category",
    entityId: id,
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
  const [row] = await db
    .insert(menuItems)
    .values({
      businessId: actor.businessId,
      categoryId: input.categoryId || null,
      name: input.name,
      description: input.description || null,
      basePrice: input.basePrice,
      taxBehavior: input.taxBehavior,
      tracksInventory: input.tracksInventory,
      active: input.active,
      displayOrder: input.displayOrder,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "menu_item.created",
    entityType: "menu_item",
    entityId: row.id,
    after: row,
  });
  return row;
}

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
// POS catalog (active-only, shaped for the order-entry screen)
// ---------------------------------------------------------------------------

export interface PosModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;
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
}

export interface PosMenuItem {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  variants: PosVariant[];
  modifierGroups: PosModifierGroup[];
}

export interface PosCategory {
  id: string;
  name: string;
}

export async function getPosMenu(
  db: Database,
  businessId: string,
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
    list.push({ id: v.id, name: v.name, price: v.price });
    variantsByItem.set(v.menuItemId, list);
  }

  const optionsByGroup = new Map<string, PosModifierOption[]>();
  for (const o of options) {
    const list = optionsByGroup.get(o.modifierGroupId) ?? [];
    list.push({ id: o.id, name: o.name, priceAdjustment: o.priceAdjustment });
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

  const posItems: PosMenuItem[] = items
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      imageUrl: item.imageUrl,
      categoryId: item.categoryId,
      variants: variantsByItem.get(item.id) ?? [],
      modifierGroups: groupsByItem.get(item.id) ?? [],
    }))
    .filter((item) => item.variants.length > 0); // an item with no active variant can't be ordered

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
