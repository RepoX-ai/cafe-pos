import { describe, expect, it } from "vitest";
import { addLineDemand, describeShortage, findShortages, type DemandTotals, type StockLevels } from "@/lib/pos/stock-demand";

const BEEF = "beef";
const RICE = "rice";
const stock: StockLevels = {
  [BEEF]: { name: "Beef", unit: "gram", available: "100.0000" },
  [RICE]: { name: "Rice", unit: "gram", available: "1000.0000" },
};

const variant = [{ ingredientId: BEEF, quantity: 60 }, { ingredientId: RICE, quantity: 200 }];
const extraBeef = [{ ingredientId: BEEF, quantity: 60 }];
const beefTopping = [{ ingredientId: BEEF, quantity: 15 }];

function shortagesFor(parts: typeof variant[], quantity: number, cart: DemandTotals = new Map()) {
  return findShortages(addLineDemand(new Map(cart), parts, quantity), stock);
}

describe("POS combined stock demand", () => {
  it("each choice fits on its own, but a 60 g variant plus a 60 g modifier needs 120 g of 100 g", () => {
    expect(shortagesFor([variant], 1)).toEqual([]);
    expect(shortagesFor([extraBeef], 1)).toEqual([]);

    const [shortage] = shortagesFor([variant, extraBeef], 1);
    expect(shortage).toMatchObject({ ingredientId: BEEF, needed: 1_200_000n, available: 1_000_000n });
    expect(describeShortage(shortage)).toBe("Not enough Beef: needs 120 g, 100 g in stock (20 g short).");
  });

  it("sums a shared ingredient across the variant and several modifiers", () => {
    expect(shortagesFor([variant, beefTopping, beefTopping], 1)).toEqual([]); // 90 g
    const [shortage] = shortagesFor([variant, beefTopping, beefTopping, beefTopping], 1); // 105 g
    expect(shortage.needed).toBe(1_050_000n);
  });

  it("multiplies the whole line by its quantity", () => {
    const smallBowl = [{ ingredientId: BEEF, quantity: 40 }];
    expect(shortagesFor([smallBowl], 2)).toEqual([]); // 80 g
    expect(shortagesFor([smallBowl], 3)[0].needed).toBe(1_200_000n); // 120 g
  });

  it("counts what is already in the order", () => {
    const cart = addLineDemand(new Map(), [variant], 1); // 60 g already taken
    expect(shortagesFor([beefTopping], 1, cart)).toEqual([]); // 75 g
    expect(shortagesFor([variant], 1, cart)[0].needed).toBe(1_200_000n);
  });

  it("reports nothing when stock isn't gated (negative-stock mode sends no stock levels)", () => {
    expect(findShortages(addLineDemand(new Map(), [variant, extraBeef], 10), {})).toEqual([]);
  });

  it("rounds each line to ten-thousandths the way checkout does", () => {
    const syrup = { ingredientId: RICE, quantity: 1 / 3 };
    const totals = addLineDemand(new Map(), [[syrup], [syrup]], 3);
    expect(totals.get(RICE)).toBe(20_000n); // 2.0000 g, not 1.9999 or 2.0001
    const exact: StockLevels = { [RICE]: { name: "Syrup", unit: "millilitre", available: "2" } };
    expect(findShortages(totals, exact)).toEqual([]);
  });

  it("treats negative stock as already short", () => {
    const negative: StockLevels = { [BEEF]: { name: "Beef", unit: "gram", available: "-5" } };
    const [shortage] = findShortages(addLineDemand(new Map(), [beefTopping], 1), negative);
    expect(describeShortage(shortage)).toBe("Not enough Beef: needs 15 g, 0 g in stock (20 g short).");
  });
});
