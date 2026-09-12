import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  businesses,
  ingredients,
  menuCategories,
  menuItems,
  menuItemVariants,
  recipeLines,
  recipes,
  users,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { getTestDb, seedTestFixture } from "./helpers";
import {
  createCategory,
  createMenuItem,
  createVariant,
  createVariantWithRecipe,
  deleteCategory,
  deleteMenuItem,
  deleteVariant,
  setMenuItemActive,
  updateMenuItem,
} from "@/server/services/menu-service";
import { submitOrder } from "@/server/services/order-service";
import type { MenuItemInput } from "@/lib/validation/menu";

const db = getTestDb();

function baseInput(overrides: Partial<MenuItemInput> = {}): MenuItemInput {
  return {
    name: "Croissant",
    basePrice: 15_000,
    taxBehavior: "exclusive",
    tracksInventory: true,
    active: true,
    displayOrder: 0,
    ...overrides,
  };
}

async function seedBusinessAndUser(testDb: NonNullable<typeof db>) {
  const suffix = randomUUID().slice(0, 8);
  const [business] = await testDb
    .insert(businesses)
    .values({ name: `Test Café ${suffix}`, orderNumberPrefix: "TST" })
    .returning();
  const [user] = await testDb
    .insert(users)
    .values({
      businessId: business.id,
      name: "Test Owner",
      email: `owner-${suffix}@test.local`,
      passwordHash: await hashPassword("irrelevant"),
    })
    .returning();
  return { business, user };
}

describe.skipIf(!db)("createMenuItem always gives the item a recipe-able variant (integration)", () => {
  it("auto-creates a default 'Regular' variant priced at basePrice", async () => {
    const { business, user } = await seedBusinessAndUser(db!);

    const item = await createMenuItem(db!, { businessId: business.id, userId: user.id }, baseInput());

    const variants = await db!.select().from(menuItemVariants).where(eq(menuItemVariants.menuItemId, item.id));
    expect(variants).toHaveLength(1);
    expect(variants[0].name).toBe("Regular");
    expect(variants[0].price).toBe(15_000);
  });

  it("no longer touches the variant's price on a basePrice edit (price is edited via the variant now)", async () => {
    const { business, user } = await seedBusinessAndUser(db!);
    const actor = { businessId: business.id, userId: user.id };

    const item = await createMenuItem(db!, actor, baseInput({ basePrice: 15_000 }));
    // The item edit form no longer exposes basePrice for editing — it just
    // carries the stored value through unchanged via a hidden field — but
    // even if something did pass a different value here, updateMenuItem
    // must not propagate it into the variant's own price any more.
    await updateMenuItem(db!, actor, item.id, baseInput({ name: "Croissant", basePrice: 18_000 }));

    const variants = await db!.select().from(menuItemVariants).where(eq(menuItemVariants.menuItemId, item.id));
    expect(variants).toHaveLength(1);
    expect(variants[0].price).toBe(15_000);
  });
});

describe.skipIf(!db)("createVariantWithRecipe (integration)", () => {
  it("creates a variant with no recipe when no lines are given", async () => {
    const { business, user } = await seedBusinessAndUser(db!);
    const actor = { businessId: business.id, userId: user.id };
    const item = await createMenuItem(db!, actor, baseInput());

    const variant = await createVariantWithRecipe(
      db!,
      actor,
      item.id,
      { name: "Large", price: 20_000, active: true, displayOrder: 1 },
      [],
    );

    const [recipe] = await db!.select().from(recipes).where(eq(recipes.menuItemVariantId, variant.id));
    expect(recipe).toBeUndefined();
  });

  it("creates a variant and its first recipe version in one transaction", async () => {
    const { business, user } = await seedBusinessAndUser(db!);
    const actor = { businessId: business.id, userId: user.id };
    const item = await createMenuItem(db!, actor, baseInput());

    const suffix = randomUUID().slice(0, 8);
    const [ingredient] = await db!
      .insert(ingredients)
      .values({ businessId: business.id, name: `Flour ${suffix}`, baseUnit: "gram", currentQuantityBaseUnits: "5000" })
      .returning();

    const variant = await createVariantWithRecipe(
      db!,
      actor,
      item.id,
      { name: "Large", price: 20_000, active: true, displayOrder: 1 },
      [{ ingredientId: ingredient.id, quantityBaseUnits: 50, wastePercentage: 0 }],
    );

    const [recipe] = await db!
      .select()
      .from(recipes)
      .where(eq(recipes.menuItemVariantId, variant.id));
    expect(recipe).toBeDefined();
    expect(recipe.active).toBe(true);

    const lines = await db!.select().from(recipeLines).where(eq(recipeLines.recipeId, recipe.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].ingredientId).toBe(ingredient.id);
  });
});

describe.skipIf(!db)("permanent deletes are refused for anything already sold (integration)", () => {
  it("deletes an unsold item along with its variants and recipes", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };

    await deleteMenuItem(db!, actor, menuItem.id);

    const items = await db!.select().from(menuItems).where(eq(menuItems.id, menuItem.id));
    expect(items).toHaveLength(0);
    // ON DELETE CASCADE should have taken the variant and its recipe too.
    const leftoverVariants = await db!
      .select()
      .from(menuItemVariants)
      .where(eq(menuItemVariants.id, variant.id));
    expect(leftoverVariants).toHaveLength(0);
    const leftoverRecipes = await db!
      .select()
      .from(recipes)
      .where(eq(recipes.menuItemVariantId, variant.id));
    expect(leftoverRecipes).toHaveLength(0);
  });

  it("refuses to delete an item that appears on an order, and leaves it intact", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };
    await submitOrder(db!, actor, {
      idempotencyKey: `delete-guard-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    await expect(deleteMenuItem(db!, actor, menuItem.id)).rejects.toThrow(/Archive it instead/);

    const stillThere = await db!.select().from(menuItems).where(eq(menuItems.id, menuItem.id));
    expect(stillThere).toHaveLength(1);
  });

  it("refuses to delete a sold variant but allows an unsold sibling", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };
    const unsold = await createVariant(db!, actor, menuItem.id, {
      name: "Large",
      price: 25_000,
      active: true,
      displayOrder: 1,
    });
    await submitOrder(db!, actor, {
      idempotencyKey: `variant-guard-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    await expect(deleteVariant(db!, actor, menuItem.id, variant.id)).rejects.toThrow(/Archive it instead/);

    await deleteVariant(db!, actor, menuItem.id, unsold.id);
    const remaining = await db!
      .select()
      .from(menuItemVariants)
      .where(eq(menuItemVariants.menuItemId, menuItem.id));
    expect(remaining.map((v) => v.id)).toEqual([variant.id]);
  });

  it("refuses to delete an item's last remaining variant", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };

    await expect(deleteVariant(db!, actor, menuItem.id, variant.id)).rejects.toThrow(/only variant/);
  });

  it("refuses to delete a category that still holds an archived item", async () => {
    const { business, user } = await seedBusinessAndUser(db!);
    const actor = { businessId: business.id, userId: user.id };
    const category = await createCategory(db!, actor, { name: `Pastry ${randomUUID().slice(0, 8)}`, displayOrder: 0 });
    const item = await createMenuItem(db!, actor, baseInput({ categoryId: category.id }));
    await setMenuItemActive(db!, actor, item.id, false);

    await expect(deleteCategory(db!, actor, category.id)).rejects.toThrow(/still holds 1 menu item/);

    // Once nothing points at it, the same delete goes through.
    await deleteMenuItem(db!, actor, item.id);
    await deleteCategory(db!, actor, category.id);
    const left = await db!.select().from(menuCategories).where(eq(menuCategories.id, category.id));
    expect(left).toHaveLength(0);
  });

  it("scopes deletes to the caller's business", async () => {
    const { business, user } = await seedBusinessAndUser(db!);
    const other = await seedBusinessAndUser(db!);
    const item = await createMenuItem(db!, { businessId: business.id, userId: user.id }, baseInput());

    await expect(
      deleteMenuItem(db!, { businessId: other.business.id, userId: other.user.id }, item.id),
    ).rejects.toThrow(/not found/i);

    const stillThere = await db!.select().from(menuItems).where(eq(menuItems.id, item.id));
    expect(stillThere).toHaveLength(1);
  });
});
