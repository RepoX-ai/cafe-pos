import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { businesses, ingredients, menuItemVariants, recipeLines, recipes, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { getTestDb } from "./helpers";
import { createMenuItem, createVariantWithRecipe, updateMenuItem } from "@/server/services/menu-service";
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
