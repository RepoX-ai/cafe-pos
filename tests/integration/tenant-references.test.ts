import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTestDb, seedTestFixture, type TestDb } from "./helpers";
import {
  createCategory,
  createMenuItem,
  createModifierGroup,
  createModifierOption,
  deleteCategory,
  getMenuItemById,
  getPosMenu,
  listMenuItemsWithVariants,
  saveModifierOptionRecipe,
  setCategoryActive,
  setItemModifierGroups,
  setMenuItemActive,
  updateMenuItem,
} from "@/server/services/menu-service";
import { createAndFinalizePurchase, getPurchaseWithLines, listPurchases } from "@/server/services/purchase-service";
import { createSupplier, setSupplierActive, updateSupplier } from "@/server/services/supplier-service";
import { getActiveRecipe, saveRecipe } from "@/server/services/recipe-service";
import { NotFoundError, ServiceError } from "@/server/services/errors";
import type { MenuItemInput } from "@/lib/validation/menu";

const db = getTestDb();
afterAll(async () => {
  await db?.$client.end();
});

const itemInput = (overrides: Partial<MenuItemInput> = {}): MenuItemInput => ({
  name: `Item ${randomUUID().slice(0, 6)}`,
  basePrice: 10_000,
  taxBehavior: "exclusive",
  tracksInventory: true,
  active: true,
  displayOrder: 0,
  ...overrides,
});

/** Two cafés, each with a category, a modifier group + option, and a supplier. */
async function twoCafes(db: TestDb) {
  const a = await seedTestFixture(db);
  const b = await seedTestFixture(db);
  const actorA = { businessId: a.business.id, userId: a.user.id };
  const actorB = { businessId: b.business.id, userId: b.user.id };
  const catA = await createCategory(db, actorA, { name: "Coffee A", displayOrder: 0 });
  const catB = await createCategory(db, actorB, { name: "Secret B category", displayOrder: 0 });
  const groupA = await createModifierGroup(db, actorA, { name: "Milk A", required: false, minSelections: 0, maxSelections: 1 });
  const groupB = await createModifierGroup(db, actorB, { name: "Secret B group", required: false, minSelections: 0, maxSelections: 1 });
  const optionB = await createModifierOption(db, actorB, groupB.id, { name: "Secret B option", priceAdjustment: 1, active: true, displayOrder: 0 });
  const supplierB = await createSupplier(db, actorB, { name: "Secret B supplier" });
  return { a, b, actorA, actorB, catA, catB, groupA, groupB, optionB, supplierB };
}

async function auditCount(db: TestDb, businessId: string) {
  return db.$count(schema.auditLogs, eq(schema.auditLogs.businessId, businessId));
}

describe.skipIf(!db)("cross-tenant references (PostgreSQL)", () => {
  it("refuses another business's category on create and update, and writes nothing", async () => {
    const t = await twoCafes(db!);
    const before = await db!.$count(schema.menuItems, eq(schema.menuItems.businessId, t.a.business.id));
    const auditBefore = await auditCount(db!, t.a.business.id);

    await expect(createMenuItem(db!, t.actorA, itemInput({ categoryId: t.catB.id }))).rejects.toThrow(NotFoundError);
    await expect(updateMenuItem(db!, t.actorA, t.a.menuItem.id, itemInput({ categoryId: t.catB.id }))).rejects.toThrow(NotFoundError);

    expect(await db!.$count(schema.menuItems, eq(schema.menuItems.businessId, t.a.business.id))).toBe(before);
    const [item] = await db!.select().from(schema.menuItems).where(eq(schema.menuItems.id, t.a.menuItem.id));
    expect(item.categoryId).toBeNull();
    expect(await auditCount(db!, t.a.business.id)).toBe(auditBefore);

    // The own-business category still works.
    const ok = await updateMenuItem(db!, t.actorA, t.a.menuItem.id, itemInput({ categoryId: t.catA.id }));
    expect(ok.categoryId).toBe(t.catA.id);
  });

  it("rejects a mixed-tenant modifier assignment atomically, leaving the previous assignment intact", async () => {
    const t = await twoCafes(db!);
    await setItemModifierGroups(db!, t.actorA, t.a.menuItem.id, [t.groupA.id]);

    await expect(setItemModifierGroups(db!, t.actorA, t.a.menuItem.id, [t.groupA.id, t.groupB.id])).rejects.toThrow(NotFoundError);
    await expect(setItemModifierGroups(db!, t.actorA, t.a.menuItem.id, [t.groupB.id])).rejects.toThrow(NotFoundError);

    const rows = await db!.select().from(schema.menuItemModifierGroups).where(eq(schema.menuItemModifierGroups.menuItemId, t.a.menuItem.id));
    expect(rows.map((r) => r.modifierGroupId)).toEqual([t.groupA.id]);
    // And B's option never reaches A's POS catalog or checkout validation.
    const pos = await getPosMenu(db!, t.a.business.id, { allowNegativeStock: true });
    expect(JSON.stringify(pos)).not.toContain(t.optionB.id);
    expect(JSON.stringify(pos)).not.toContain("Secret B");
  });

  it("refuses another business's supplier on a purchase without touching stock", async () => {
    const t = await twoCafes(db!);
    const [stockBefore] = await db!.select().from(schema.ingredients).where(eq(schema.ingredients.id, t.a.ingredient.id));

    await expect(
      createAndFinalizePurchase(db!, t.actorA, {
        supplierId: t.supplierB.id,
        purchaseDate: "2026-09-01",
        lines: [{ ingredientId: t.a.ingredient.id, quantityPurchased: 1, purchaseUnit: "kg", conversionToBaseUnits: 1000, unitPurchaseCost: 100_000 }],
      }),
    ).rejects.toThrow(NotFoundError);

    const [stockAfter] = await db!.select().from(schema.ingredients).where(eq(schema.ingredients.id, t.a.ingredient.id));
    expect(stockAfter.currentQuantityBaseUnits).toBe(stockBefore.currentQuantityBaseUnits);
    expect(stockAfter.averageCostPerBaseUnit).toBe(stockBefore.averageCostPerBaseUnit);
    expect(await db!.$count(schema.purchases, eq(schema.purchases.businessId, t.a.business.id))).toBe(0);
  });

  it("cannot read or mutate another business's rows by id", async () => {
    const t = await twoCafes(db!);
    const purchaseB = await createAndFinalizePurchase(db!, t.actorB, {
      supplierId: t.supplierB.id,
      purchaseDate: "2026-09-01",
      lines: [{ ingredientId: t.b.ingredient.id, quantityPurchased: 1, purchaseUnit: "kg", conversionToBaseUnits: 1000, unitPurchaseCost: 50_000 }],
    });

    expect(await getMenuItemById(db!, t.a.business.id, t.b.menuItem.id)).toBeNull();
    expect(await getPurchaseWithLines(db!, t.a.business.id, purchaseB.id)).toBeNull();
    expect(await listPurchases(db!, t.a.business.id, { limit: 50, offset: 0 })).toEqual([]);
    await expect(getActiveRecipe(db!, t.a.business.id, t.b.variant.id)).rejects.toThrow(NotFoundError);
    const listed = await listMenuItemsWithVariants(db!, t.a.business.id);
    expect(listed.map((i) => i.id)).not.toContain(t.b.menuItem.id);

    const auditBefore = await auditCount(db!, t.a.business.id);
    await expect(updateMenuItem(db!, t.actorA, t.b.menuItem.id, itemInput())).rejects.toThrow(NotFoundError);
    await expect(setMenuItemActive(db!, t.actorA, t.b.menuItem.id, false)).rejects.toThrow(NotFoundError);
    await expect(setCategoryActive(db!, t.actorA, t.catB.id, false)).rejects.toThrow(NotFoundError);
    await expect(deleteCategory(db!, t.actorA, t.catB.id)).rejects.toThrow(NotFoundError);
    await expect(updateSupplier(db!, t.actorA, t.supplierB.id, { name: "hijacked" })).rejects.toThrow(NotFoundError);
    await expect(setSupplierActive(db!, t.actorA, t.supplierB.id, false)).rejects.toThrow(NotFoundError);
    await expect(setItemModifierGroups(db!, t.actorA, t.b.menuItem.id, [])).rejects.toThrow(NotFoundError);
    await expect(
      saveRecipe(db!, t.actorA, { menuItemVariantId: t.b.variant.id, lines: [{ ingredientId: t.a.ingredient.id, quantityBaseUnits: 1, wastePercentage: 0 }] }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      saveRecipe(db!, t.actorA, { menuItemVariantId: t.a.variant.id, lines: [{ ingredientId: t.b.ingredient.id, quantityBaseUnits: 1, wastePercentage: 0 }] }),
    ).rejects.toThrow(ServiceError);
    await expect(
      saveModifierOptionRecipe(db!, t.actorA, { groupId: t.groupB.id, optionId: t.optionB.id, lines: [] }),
    ).rejects.toThrow(NotFoundError);
    expect(await auditCount(db!, t.a.business.id)).toBe(auditBefore);

    const [itemB] = await db!.select().from(schema.menuItems).where(eq(schema.menuItems.id, t.b.menuItem.id));
    expect(itemB.active).toBe(true);
    const [catB] = await db!.select().from(schema.menuCategories).where(eq(schema.menuCategories.id, t.catB.id));
    expect(catB.active).toBe(true);
    const [supB] = await db!.select().from(schema.suppliers).where(eq(schema.suppliers.id, t.supplierB.id));
    expect(supB).toMatchObject({ name: "Secret B supplier", active: true });
  });

  it("enforces same-business references in the database even if a code path forgets", async () => {
    const t = await twoCafes(db!);
    const fk = (constraint: string) => expect.objectContaining({ cause: expect.objectContaining({ code: "23503", constraint }) });

    await expect(
      db!.update(schema.menuItems).set({ categoryId: t.catB.id }).where(eq(schema.menuItems.id, t.a.menuItem.id)),
    ).rejects.toEqual(fk("menu_items_category_same_business_fk"));
    await expect(
      db!.insert(schema.menuItemModifierGroups).values({ businessId: t.a.business.id, menuItemId: t.a.menuItem.id, modifierGroupId: t.groupB.id }),
    ).rejects.toEqual(fk("menu_item_modifier_groups_group_same_business_fk"));
    await expect(
      db!.insert(schema.purchases).values({ businessId: t.a.business.id, supplierId: t.supplierB.id, purchaseDate: "2026-09-01" }),
    ).rejects.toEqual(fk("purchases_supplier_same_business_fk"));
    const [recipeA] = await db!.select().from(schema.recipes).where(eq(schema.recipes.menuItemVariantId, t.a.variant.id));
    await expect(
      db!.insert(schema.recipeLines).values({ businessId: t.a.business.id, recipeId: recipeA.id, ingredientId: t.b.ingredient.id, quantityBaseUnits: "1" }),
    ).rejects.toEqual(fk("recipe_lines_ingredient_same_business_fk"));
    await expect(
      db!.update(schema.ingredients).set({ preferredSupplierId: t.supplierB.id }).where(eq(schema.ingredients.id, t.a.ingredient.id)),
    ).rejects.toEqual(fk("ingredients_preferred_supplier_same_business_fk"));
  });

  it("un-assigns items when their category is deleted, instead of failing the foreign key", async () => {
    const t = await twoCafes(db!);
    await updateMenuItem(db!, t.actorA, t.a.menuItem.id, itemInput({ categoryId: t.catA.id }));
    await deleteCategory(db!, t.actorA, t.catA.id);
    const [item] = await db!
      .select()
      .from(schema.menuItems)
      .where(and(eq(schema.menuItems.id, t.a.menuItem.id), eq(schema.menuItems.businessId, t.a.business.id)));
    expect(item.categoryId).toBeNull();
  });
});
