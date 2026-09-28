import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  businesses,
  ingredients,
  menuItemModifierGroups,
  modifierGroups,
  modifierOptions,
  modifierRecipeLines,
  recipeLines,
} from "@/lib/db/schema";
import { getTestDb, seedTestFixture, type TestDb } from "./helpers";
import { getPosMenu, type PosMenuItem } from "@/server/services/menu-service";
import { submitOrder } from "@/server/services/order-service";
import { InsufficientStockError } from "@/server/services/inventory-service";
import { createWasteRecord } from "@/server/services/waste-service";
import { addLineDemand, findShortages, type StockLevels } from "@/lib/pos/stock-demand";

/**
 * The POS preview and checkout must reach the same verdict. Each case asks
 * the preview first, then submits the same cart and checks checkout agrees.
 */

const db = getTestDb();

/** 100 g of beef; the bowl needs 60 g, and two modifiers need 60 g and 15 g more. */
async function seedBeefBowl(db: TestDb, opts: { stock?: string } = {}) {
  const fx = await seedTestFixture(db, { openingStock: opts.stock ?? "100" });
  await db.update(recipeLines).set({ quantityBaseUnits: "60" }).where(eq(recipeLines.ingredientId, fx.ingredient.id));

  const [group] = await db
    .insert(modifierGroups)
    .values({ businessId: fx.business.id, name: "Toppings", required: false, minSelections: 0, maxSelections: 3 })
    .returning();
  const [extraBeef, onsenEgg] = await db
    .insert(modifierOptions)
    .values([
      { modifierGroupId: group.id, name: "Extra beef", priceAdjustment: 10_000 },
      { modifierGroupId: group.id, name: "Beef crumbs", priceAdjustment: 3_000 },
    ])
    .returning();
  await db.insert(menuItemModifierGroups).values({ businessId: fx.business.id, menuItemId: fx.menuItem.id, modifierGroupId: group.id });
  await db.insert(modifierRecipeLines).values([
    { businessId: fx.business.id, modifierOptionId: extraBeef.id, ingredientId: fx.ingredient.id, quantityBaseUnits: "60" },
    { businessId: fx.business.id, modifierOptionId: onsenEgg.id, ingredientId: fx.ingredient.id, quantityBaseUnits: "15" },
  ]);
  return { ...fx, extraBeefId: extraBeef.id, crumbsId: onsenEgg.id };
}

type Fixture = Awaited<ReturnType<typeof seedBeefBowl>>;

async function loadPos(db: TestDb, businessId: string) {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  return getPosMenu(db, businessId, { allowNegativeStock: business.allowNegativeStock });
}

function preview(item: PosMenuItem, stock: StockLevels, optionIds: string[], quantity: number) {
  const options = item.modifierGroups.flatMap((g) => g.options);
  const parts = [item.variants[0].demand, ...optionIds.map((id) => options.find((o) => o.id === id)!.demand)];
  return findShortages(addLineDemand(new Map(), parts, quantity), stock);
}

async function checkout(db: TestDb, fx: Fixture, optionIds: string[], quantity: number) {
  return submitOrder(db, { businessId: fx.business.id, userId: fx.user.id }, {
    idempotencyKey: crypto.randomUUID(),
    orderType: "takeaway",
    discountTotal: 0,
    lines: [{ menuItemId: fx.menuItem.id, menuItemVariantId: fx.variant.id, quantity, modifierOptionIds: optionIds }],
  });
}

describe.skipIf(!db)("POS combined stock demand agrees with checkout", () => {
  it("flags a variant plus modifier that each fit alone but not together, and checkout refuses it", async () => {
    const fx = await seedBeefBowl(db!);
    const { items, stock } = await loadPos(db!, fx.business.id);
    const item = items.find((i) => i.id === fx.menuItem.id)!;

    // The old per-choice flags: both look available.
    expect(item.variants[0].inStock).toBe(true);
    expect(item.modifierGroups[0].options.every((o) => o.inStock)).toBe(true);

    const shortages = preview(item, stock, [fx.extraBeefId], 1);
    expect(shortages).toEqual([expect.objectContaining({ ingredientId: fx.ingredient.id, needed: 1_200_000n, available: 1_000_000n })]);
    await expect(checkout(db!, fx, [fx.extraBeefId], 1)).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("sums the shared ingredient across the variant and two modifiers", async () => {
    const fx = await seedBeefBowl(db!, { stock: "135" });
    const { items, stock } = await loadPos(db!, fx.business.id);
    const item = items.find((i) => i.id === fx.menuItem.id)!;

    expect(preview(item, stock, [fx.extraBeefId, fx.crumbsId], 1)).toEqual([]); // 60 + 60 + 15 = 135
    await expect(checkout(db!, fx, [fx.extraBeefId, fx.crumbsId], 1)).resolves.toBeDefined();

    const after = await loadPos(db!, fx.business.id);
    expect(after.stock[fx.ingredient.id].available).toMatch(/^0(\.0+)?$/);
  });

  it("multiplies by quantity: two bowls fit in 120 g, three do not", async () => {
    const fx = await seedBeefBowl(db!, { stock: "120" });
    const { items, stock } = await loadPos(db!, fx.business.id);
    const item = items.find((i) => i.id === fx.menuItem.id)!;

    expect(preview(item, stock, [], 3)).toHaveLength(1);
    await expect(checkout(db!, fx, [], 3)).rejects.toBeInstanceOf(InsufficientStockError);
    expect(preview(item, stock, [], 2)).toEqual([]);
    await expect(checkout(db!, fx, [], 2)).resolves.toBeDefined();
  });

  it("sends no stock data in negative-stock mode, and checkout lets the sale through", async () => {
    const fx = await seedBeefBowl(db!);
    await db!.update(businesses).set({ allowNegativeStock: true }).where(eq(businesses.id, fx.business.id));
    const { items, stock } = await loadPos(db!, fx.business.id);
    const item = items.find((i) => i.id === fx.menuItem.id)!;

    expect(stock).toEqual({});
    expect(item.variants[0].demand).toEqual([]);
    expect(preview(item, stock, [fx.extraBeefId], 2)).toEqual([]);
    await expect(checkout(db!, fx, [fx.extraBeefId], 2)).resolves.toBeDefined();
    const [row] = await db!.select().from(ingredients).where(eq(ingredients.id, fx.ingredient.id));
    expect(Number(row.currentQuantityBaseUnits)).toBe(-140);
  });

  it("keeps checkout's own check when stock drops after the POS loaded", async () => {
    const fx = await seedBeefBowl(db!);
    const { items, stock } = await loadPos(db!, fx.business.id);
    const item = items.find((i) => i.id === fx.menuItem.id)!;
    expect(preview(item, stock, [], 1)).toEqual([]); // 60 g of 100 g, as loaded

    await createWasteRecord(db!, { businessId: fx.business.id, userId: fx.user.id }, {
      ingredientId: fx.ingredient.id,
      quantityBaseUnits: 50,
      reason: "spilled",
      idempotencyKey: crypto.randomUUID(),
    });

    await expect(checkout(db!, fx, [], 1)).rejects.toBeInstanceOf(InsufficientStockError);
    const reloaded = await loadPos(db!, fx.business.id);
    const reloadedItem = reloaded.items.find((i) => i.id === fx.menuItem.id)!;
    expect(preview(reloadedItem, reloaded.stock, [], 1)).toHaveLength(1);
  });
});
