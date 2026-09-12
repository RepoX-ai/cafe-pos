import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  businesses,
  menuItemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
  modifierRecipeLines,
} from "@/lib/db/schema";
import { getTestDb, seedTestFixture } from "./helpers";
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
    await db!.insert(menuItemModifierGroups).values({ menuItemId: menuItem.id, modifierGroupId: group.id });
    // Ingredient only has 1000g; the modifier alone asks for more than that.
    await db!.insert(modifierRecipeLines).values({
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
});
