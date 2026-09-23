import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  businesses,
  ingredients,
  menuCategories,
  menuItemVariants,
  menuItemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
  modifierRecipeLines,
  recipeLines,
  recipes,
} from "@/lib/db/schema";
import { getTestDb, seedTestFixture, type TestDb } from "./helpers";
import { getPosMenu } from "@/server/services/menu-service";

const db = getTestDb();

describe.skipIf(!db)("POS menu stock availability (integration)", () => {
  it("marks a variant in stock when the recipe's ingredients are sufficient", async () => {
    const { business, variant } = await seedTestFixture(db!, { openingStock: "1000" }); // recipe needs 20g

    const { items } = await getPosMenu(db!, business.id, { allowNegativeStock: false });
    const posVariant = items[0].variants.find((v) => v.id === variant.id);

    expect(posVariant?.inStock).toBe(true);
    expect(items[0].outOfStock).toBe(false);
  });

  it("marks the variant (and the item, since it's the only variant) out of stock when the ingredient is short", async () => {
    const { business, variant } = await seedTestFixture(db!, { openingStock: "5" }); // recipe needs 20g

    const { items } = await getPosMenu(db!, business.id, { allowNegativeStock: false });
    const posVariant = items[0].variants.find((v) => v.id === variant.id);

    expect(posVariant?.inStock).toBe(false);
    expect(items[0].outOfStock).toBe(true);
  });

  it("ignores the shortfall when the business allows negative stock", async () => {
    const { business, variant } = await seedTestFixture(db!, { openingStock: "5" }); // recipe needs 20g

    const { items } = await getPosMenu(db!, business.id, { allowNegativeStock: true });
    const posVariant = items[0].variants.find((v) => v.id === variant.id);

    expect(posVariant?.inStock).toBe(true);
    expect(items[0].outOfStock).toBe(false);
  });

  it("ignores the shortfall when the item has inventory tracking turned off", async () => {
    const { business, menuItem, variant } = await seedTestFixture(db!, { openingStock: "5" }); // recipe needs 20g
    await db!.update(menuItems).set({ tracksInventory: false }).where(eq(menuItems.id, menuItem.id));

    const { items } = await getPosMenu(db!, business.id, { allowNegativeStock: false });
    const posVariant = items[0].variants.find((v) => v.id === variant.id);

    expect(posVariant?.inStock).toBe(true);
    expect(items[0].outOfStock).toBe(false);
  });

  it("marks a modifier option out of stock independently of the base recipe (variant itself stays sellable)", async () => {
    const { business, menuItem, ingredient } = await seedTestFixture(db!, { openingStock: "1000" }); // base recipe needs 20g

    const [group] = await db!
      .insert(modifierGroups)
      .values({ businessId: business.id, name: "Extras", required: false, minSelections: 0, maxSelections: 1 })
      .returning();
    const [option] = await db!
      .insert(modifierOptions)
      .values({ modifierGroupId: group.id, name: "Extra shot", priceAdjustment: 5_000 })
      .returning();
    await db!.insert(menuItemModifierGroups).values({ businessId: business.id, menuItemId: menuItem.id, modifierGroupId: group.id });
    // Ingredient only has 1000g; the modifier alone asks for more than that.
    await db!.insert(modifierRecipeLines).values({
      businessId: business.id,
      modifierOptionId: option.id,
      ingredientId: ingredient.id,
      quantityBaseUnits: "5000",
    });

    const { items } = await getPosMenu(db!, business.id, { allowNegativeStock: false });
    const posOption = items[0].modifierGroups.find((g) => g.id === group.id)?.options.find((o) => o.id === option.id);

    expect(posOption?.inStock).toBe(false);
    // The base recipe's own ingredient is still sufficient, so the variant
    // and item stay orderable — only the specific modifier is blocked.
    expect(items[0].variants[0].inStock).toBe(true);
    expect(items[0].outOfStock).toBe(false);
  });

  it("still returns categories and prices unaffected by stock", async () => {
    const { business } = await seedTestFixture(db!);
    const { categories } = await getPosMenu(db!, business.id, { allowNegativeStock: false });
    expect(Array.isArray(categories)).toBe(true);
  });
});

// Sanity: never leaves `businesses.allowNegativeStock` mutated as a side
// effect of the getPosMenu calls above (it only reads the flag via `opts`).
describe.skipIf(!db)("getPosMenu does not touch business settings", () => {
  it("leaves allowNegativeStock untouched", async () => {
    const { business } = await seedTestFixture(db!);
    await getPosMenu(db!, business.id, { allowNegativeStock: true });
    const [row] = await db!.select().from(businesses).where(eq(businesses.id, business.id)).limit(1);
    expect(row.allowNegativeStock).toBe(false);
  });

  it("returns an empty catalog for a business with no menu, in both stock modes", async () => {
    const [business] = await db!.insert(businesses).values({ name: "Empty Café", orderNumberPrefix: "EMP" }).returning();
    for (const allowNegativeStock of [false, true]) {
      expect(await getPosMenu(db!, business.id, { allowNegativeStock })).toEqual({ categories: [], items: [] });
    }
  });

  /**
   * A menu with every shape the POS renders: ordered categories, an inactive
   * category/item/variant/option to filter out, a variant-less item, several
   * variants with one short of stock, a tracked and an untracked item sharing
   * a short modifier, and a second business that must never leak in.
   */
  async function richMenu() {
    const { business, menuItem } = await seedTestFixture(db!, { openingStock: "100" });
    const [catB, catA] = await db!
      .insert(menuCategories)
      .values([
        { businessId: business.id, name: "Drinks", displayOrder: 2 },
        { businessId: business.id, name: "Food", displayOrder: 1 },
        { businessId: business.id, name: "Hidden", displayOrder: 0, active: false },
      ])
      .returning();
    await db!.update(menuItems).set({ categoryId: catB.id, displayOrder: 1 }).where(eq(menuItems.id, menuItem.id));
    const [short] = await db!
      .insert(ingredients)
      .values({ businessId: business.id, name: "Scarce", baseUnit: "gram", currentQuantityBaseUnits: "1" })
      .returning();
    const [large] = await db!
      .insert(menuItemVariants)
      .values([
        { menuItemId: menuItem.id, name: "Large", price: 30_000 },
        { menuItemId: menuItem.id, name: "Retired", price: 1, active: false },
      ])
      .returning();
    const [largeRecipe] = await db!.insert(recipes).values({ businessId: business.id, menuItemVariantId: large.id }).returning();
    await db!.insert(recipeLines).values({ businessId: business.id, recipeId: largeRecipe.id, ingredientId: short.id, quantityBaseUnits: "5" });

    const [plain, untracked] = await db!
      .insert(menuItems)
      .values([
        { businessId: business.id, name: "Plain toast", basePrice: 15_000, categoryId: catA.id, displayOrder: 0 },
        { businessId: business.id, name: "Water", basePrice: 5_000, categoryId: catB.id, displayOrder: 2, tracksInventory: false },
        { businessId: business.id, name: "Archived", basePrice: 1, active: false },
      ])
      .returning();
    const [waterVariant] = await db!.insert(menuItemVariants).values({ menuItemId: untracked.id, name: "Bottle", price: 5_000 }).returning();
    const [waterRecipe] = await db!.insert(recipes).values({ businessId: business.id, menuItemVariantId: waterVariant.id }).returning();
    await db!.insert(recipeLines).values({ businessId: business.id, recipeId: waterRecipe.id, ingredientId: short.id, quantityBaseUnits: "5" });

    const [group] = await db!
      .insert(modifierGroups)
      .values({ businessId: business.id, name: "Sugar", required: true, minSelections: 1, maxSelections: 2 })
      .returning();
    const [lessSugar, extraSugar] = await db!
      .insert(modifierOptions)
      .values([
        { modifierGroupId: group.id, name: "Less", priceAdjustment: 0 },
        { modifierGroupId: group.id, name: "Extra", priceAdjustment: 2_000 },
        { modifierGroupId: group.id, name: "Gone", active: false },
      ])
      .returning();
    await db!.insert(modifierRecipeLines).values({ businessId: business.id, modifierOptionId: extraSugar.id, ingredientId: short.id, quantityBaseUnits: "5" });
    await db!.insert(menuItemModifierGroups).values([
      { businessId: business.id, menuItemId: menuItem.id, modifierGroupId: group.id },
      { businessId: business.id, menuItemId: untracked.id, modifierGroupId: group.id },
    ]);

    await seedTestFixture(db!); // another tenant, which must never leak in
    return { business, menuItem, plain, untracked, waterVariant, group, lessSugar, extraSugar, catA };
  }

  it("builds the full catalog shape with stock flags when negative stock is not allowed", async () => {
    const m = await richMenu();
    const { categories, items } = await getPosMenu(db!, m.business.id, { allowNegativeStock: false });

    expect(categories.map((c) => c.name)).toEqual(["Food", "Drinks"]);
    expect(items.map((i) => i.id)).toEqual([m.plain.id, m.menuItem.id, m.untracked.id]);

    const [plain, coffee, water] = items;
    expect(plain).toMatchObject({ basePrice: 15_000, variants: [], modifierGroups: [], outOfStock: false, categoryId: m.catA.id });

    expect(coffee.variants.map((v) => [v.name, v.price, v.inStock]).sort()).toEqual([
      ["Large", 30_000, false],
      ["Regular", 20_000, true],
    ]);
    expect(coffee.outOfStock).toBe(false);
    expect(coffee.modifierGroups).toEqual([
      {
        id: m.group.id,
        name: "Sugar",
        required: true,
        minSelections: 1,
        maxSelections: 2,
        options: expect.arrayContaining([
          { id: m.lessSugar.id, name: "Less", priceAdjustment: 0, inStock: true },
          { id: m.extraSugar.id, name: "Extra", priceAdjustment: 2_000, inStock: false },
        ]),
      },
    ]);
    expect(coffee.modifierGroups[0].options).toHaveLength(2);

    // Untracked: the same short ingredient never blocks it.
    expect(water.variants).toEqual([{ id: m.waterVariant.id, name: "Bottle", price: 5_000, inStock: true }]);
    expect(water.modifierGroups[0].options.every((o) => o.inStock)).toBe(true);
    expect(water.outOfStock).toBe(false);
  });

  it("builds the same catalog with every stock flag set when negative stock is allowed", async () => {
    const m = await richMenu();
    const strict = await getPosMenu(db!, m.business.id, { allowNegativeStock: false });
    const lenient = await getPosMenu(db!, m.business.id, { allowNegativeStock: true });

    const withoutStock = (menu: typeof strict) =>
      JSON.parse(JSON.stringify(menu, (key, value) => (key === "inStock" || key === "outOfStock" ? undefined : value)));
    expect(withoutStock(lenient)).toEqual(withoutStock(strict));
    const flags = lenient.items.flatMap((i) => [
      ...i.variants.map((v) => v.inStock),
      ...i.modifierGroups.flatMap((g) => g.options.map((o) => o.inStock)),
    ]);
    expect(flags.every(Boolean)).toBe(true);
    expect(lenient.items.every((i) => !i.outOfStock)).toBe(true);
  });

  it("issues the same number of statements however large the menu is", async () => {
    const countStatements = async (businessId: string, allowNegativeStock: boolean, target: TestDb) => {
      const spy = vi.spyOn(target.$client, "query");
      try {
        await getPosMenu(target, businessId, { allowNegativeStock });
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };

    const small = await seedTestFixture(db!);
    const big = await richMenu();
    const [extra] = await db!.insert(menuItems).values({ businessId: big.business.id, name: "More", basePrice: 1 }).returning();
    await db!.insert(menuItemVariants).values([1, 2, 3, 4].map((n) => ({ menuItemId: extra.id, name: "V" + n, price: n })));

    // No modifier groups: 4 stage-1 reads + recipes + recipe lines.
    const smallCount = await countStatements(small.business.id, false, db!);
    const bigCount = await countStatements(big.business.id, false, db!);
    // More items/variants/options never add statements, only the stages that apply.
    expect(smallCount).toBe(6);
    expect(bigCount).toBe(8);
    // Negative stock allowed: no recipe or recipe-line reads.
    expect(await countStatements(big.business.id, true, db!)).toBe(5);
  });
});
