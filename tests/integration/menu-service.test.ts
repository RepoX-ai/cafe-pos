import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  businesses,
  ingredients,
  modifierGroups,
  modifierOptions,
  menuItems,
  menuItemVariants,
  orderLines,
  recipeLines,
  recipes,
  users,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { shiftBusinessDate, todayInBusinessTimezone } from "@/lib/dates/dates";
import { getTestDb, seedTestFixture } from "./helpers";
import {
  createCategory,
  createMenuItem,
  createVariantWithRecipe,
  deleteCategory,
  deleteMenuItem,
  deleteVariant,
  listModifierGroupsWithOptions,
  saveModifierOptionRecipe,
  updateMenuItem,
} from "@/server/services/menu-service";
import { submitOrder } from "@/server/services/order-service";
import { getSalesByCategory } from "@/server/services/reports-service";
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

describe.skipIf(!db)("permanent deletes leave order history intact (integration)", () => {
  it("deletes an item along with its variants and recipes", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };

    await deleteMenuItem(db!, actor, menuItem.id);

    expect(await db!.select().from(menuItems).where(eq(menuItems.id, menuItem.id))).toHaveLength(0);
    // ON DELETE CASCADE should have taken the variant and its recipe too.
    expect(
      await db!.select().from(menuItemVariants).where(eq(menuItemVariants.id, variant.id)),
    ).toHaveLength(0);
    expect(
      await db!.select().from(recipes).where(eq(recipes.menuItemVariantId, variant.id)),
    ).toHaveLength(0);
  });

  it("deletes a sold item without changing what its past order recorded", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!, {
      openingStock: "1000",
      costPerBaseUnit: "10",
    });
    const actor = { businessId: business.id, userId: user.id };
    const category = await createCategory(db!, actor, {
      name: `Coffee ${randomUUID().slice(0, 8)}`,
      displayOrder: 0,
    });
    await db!.update(menuItems).set({ categoryId: category.id }).where(eq(menuItems.id, menuItem.id));

    const submitted = await submitOrder(db!, actor, {
      idempotencyKey: `history-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 2, modifierOptionIds: [] }],
    });
    const [before] = await db!
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, submitted.order.id));

    await deleteMenuItem(db!, actor, menuItem.id);

    const [after] = await db!.select().from(orderLines).where(eq(orderLines.id, before.id));
    // The link is severed, but every number and name the order recorded survives.
    expect(after.menuItemId).toBeNull();
    expect(after.menuItemVariantId).toBeNull();
    expect(after.itemNameSnapshot).toBe(before.itemNameSnapshot);
    expect(after.variantNameSnapshot).toBe(before.variantNameSnapshot);
    expect(after.categoryNameSnapshot).toBe(category.name);
    expect(after.unitPriceSnapshot).toBe(before.unitPriceSnapshot);
    expect(after.lineTotal).toBe(before.lineTotal);
    expect(after.cogsSnapshot).toBe(before.cogsSnapshot);
    expect(after.grossProfitSnapshot).toBe(before.grossProfitSnapshot);
  });

  it("keeps sales-by-category reporting the deleted item under its original category", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!, {
      openingStock: "1000",
      costPerBaseUnit: "10",
    });
    const actor = { businessId: business.id, userId: user.id };
    const category = await createCategory(db!, actor, {
      name: `Pastry ${randomUUID().slice(0, 8)}`,
      displayOrder: 0,
    });
    await db!.update(menuItems).set({ categoryId: category.id }).where(eq(menuItems.id, menuItem.id));

    await submitOrder(db!, actor, {
      idempotencyKey: `category-${randomUUID()}`,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    const today = todayInBusinessTimezone();
    const range = { from: shiftBusinessDate(today, -1), to: shiftBusinessDate(today, 1) };
    const rowFor = async () =>
      (await getSalesByCategory(db!, business.id, range)).find((r) => r.categoryName === category.name);

    const before = await rowFor();
    expect(before?.revenue).toBe(20_000);

    // Delete both the item and the category it belonged to.
    await deleteMenuItem(db!, actor, menuItem.id);
    await deleteCategory(db!, actor, category.id);

    const after = await rowFor();
    expect(after?.revenue).toBe(before?.revenue);
    expect(after?.quantitySold).toBe(before?.quantitySold);
  });

  it("deletes a category and leaves its items on the menu, uncategorized", async () => {
    const { business, user } = await seedBusinessAndUser(db!);
    const actor = { businessId: business.id, userId: user.id };
    const category = await createCategory(db!, actor, {
      name: `Snack ${randomUUID().slice(0, 8)}`,
      displayOrder: 0,
    });
    const item = await createMenuItem(db!, actor, baseInput({ categoryId: category.id }));

    await deleteCategory(db!, actor, category.id);

    const [survivor] = await db!.select().from(menuItems).where(eq(menuItems.id, item.id));
    expect(survivor).toBeDefined();
    expect(survivor.categoryId).toBeNull();
  });

  it("deletes a variant, including an item's last one", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };

    await deleteVariant(db!, actor, menuItem.id, variant.id);

    expect(
      await db!.select().from(menuItemVariants).where(eq(menuItemVariants.menuItemId, menuItem.id)),
    ).toHaveLength(0);
    // The item itself stays put.
    expect(await db!.select().from(menuItems).where(eq(menuItems.id, menuItem.id))).toHaveLength(1);
  });

  it("scopes deletes to the caller's business", async () => {
    const { business, user } = await seedBusinessAndUser(db!);
    const other = await seedBusinessAndUser(db!);
    const item = await createMenuItem(db!, { businessId: business.id, userId: user.id }, baseInput());

    await expect(
      deleteMenuItem(db!, { businessId: other.business.id, userId: other.user.id }, item.id),
    ).rejects.toThrow(/not found/i);

    expect(await db!.select().from(menuItems).where(eq(menuItems.id, item.id))).toHaveLength(1);
  });
});

describe.skipIf(!db)("saveModifierOptionRecipe (integration)", () => {
  it("replaces an option's ingredient lines and reports its COGS", async () => {
    const fx = await seedTestFixture(db!, { costPerBaseUnit: "10" });
    const actor = { businessId: fx.business.id, userId: fx.user.id };
    const [group] = await db!.insert(modifierGroups).values({ businessId: fx.business.id, name: "Add-on" }).returning();
    const [egg] = await db!.insert(modifierOptions).values({ modifierGroupId: group.id, name: "Egg", priceAdjustment: 7_000 }).returning();

    await saveModifierOptionRecipe(db!, actor, {
      groupId: group.id,
      optionId: egg.id,
      lines: [{ ingredientId: fx.ingredient.id, quantityBaseUnits: 50, wastePercentage: 10 }],
    });
    let [listed] = await listModifierGroupsWithOptions(db!, fx.business.id);
    expect(listed.options[0].recipeLines).toEqual([{ ingredientId: fx.ingredient.id, quantityBaseUnits: 50, wastePercentage: 10 }]);
    expect(listed.options[0].cogs).toBe(550);

    await saveModifierOptionRecipe(db!, actor, { groupId: group.id, optionId: egg.id, lines: [] });
    [listed] = await listModifierGroupsWithOptions(db!, fx.business.id);
    expect(listed.options[0].recipeLines).toEqual([]);
    expect(listed.options[0].cogs).toBe(0);
  });

  it("rejects another business's ingredient", async () => {
    const fx = await seedTestFixture(db!);
    const other = await seedTestFixture(db!);
    const [group] = await db!.insert(modifierGroups).values({ businessId: fx.business.id, name: "Add-on" }).returning();
    const [egg] = await db!.insert(modifierOptions).values({ modifierGroupId: group.id, name: "Egg" }).returning();

    await expect(
      saveModifierOptionRecipe(db!, { businessId: fx.business.id, userId: fx.user.id }, {
        groupId: group.id,
        optionId: egg.id,
        lines: [{ ingredientId: other.ingredient.id, quantityBaseUnits: 1, wastePercentage: 0 }],
      }),
    ).rejects.toThrow(/invalid/i);
  });
});
