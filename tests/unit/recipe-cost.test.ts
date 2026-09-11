import { describe, expect, it } from "vitest";
import { calculateRecipeCost, calculateRecipeLineCost, effectiveQuantity } from "@/lib/recipes/cost";

describe("recipe cost", () => {
  it("applies waste percentage on top of the stated quantity", () => {
    expect(effectiveQuantity(100, 10)).toBeCloseTo(110);
    expect(effectiveQuantity(100, 0)).toBe(100);
  });

  it("computes a single line's cost including waste", () => {
    // 18g at Rp0.25/g with 10% waste -> 19.8g -> Rp4.95 -> rounds to Rp5
    const result = calculateRecipeLineCost({
      ingredientId: "beans",
      quantityBaseUnits: 18,
      wastePercentage: 10,
      costPerBaseUnit: "0.25",
    });
    expect(result.effectiveQuantityBaseUnits).toBeCloseTo(19.8);
    expect(result.lineCostRupiah).toBe(5);
  });

  it("matches the PRD's Coffee A worked example", () => {
    // Coffee beans 18g @ Rp0.25/g, Fresh milk 150ml @ Rp0.02/ml,
    // Syrup 10ml @ Rp0.08/ml, Paper cup 1pc @ Rp500, Cup lid 1pc @ Rp200
    const cost = calculateRecipeCost([
      { ingredientId: "beans", quantityBaseUnits: 18, wastePercentage: 0, costPerBaseUnit: "0.25" },
      { ingredientId: "milk", quantityBaseUnits: 150, wastePercentage: 0, costPerBaseUnit: "0.02" },
      { ingredientId: "syrup", quantityBaseUnits: 10, wastePercentage: 0, costPerBaseUnit: "0.08" },
      { ingredientId: "cup", quantityBaseUnits: 1, wastePercentage: 0, costPerBaseUnit: "500" },
      { ingredientId: "lid", quantityBaseUnits: 1, wastePercentage: 0, costPerBaseUnit: "200" },
    ]);
    // 4.5 + 3 + 0.8 + 500 + 200 = 708.3 -> rounds to 708
    expect(cost).toBe(708);
  });

  it("sums micro-Rupiah once instead of compounding per-line rounding", () => {
    // Three lines each worth exactly Rp0.5 -> naive per-line rounding gives
    // 1+1+1=3 (round-half-up each), but summing first still gives 2 here
    // since 1.5 rounds up once, not three separate roundings of 0.5.
    const cost = calculateRecipeCost([
      { ingredientId: "a", quantityBaseUnits: 2, wastePercentage: 0, costPerBaseUnit: "0.25" },
      { ingredientId: "b", quantityBaseUnits: 2, wastePercentage: 0, costPerBaseUnit: "0.25" },
      { ingredientId: "c", quantityBaseUnits: 2, wastePercentage: 0, costPerBaseUnit: "0.25" },
    ]);
    expect(cost).toBe(2); // 0.5 + 0.5 + 0.5 = 1.5 -> rounds to 2
  });
});
