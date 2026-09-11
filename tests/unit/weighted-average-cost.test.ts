import { describe, expect, it } from "vitest";
import { calculateWeightedAverageCost } from "@/lib/purchasing/weighted-average-cost";

describe("weighted average cost", () => {
  it("matches the PRD's worked example exactly", () => {
    const result = calculateWeightedAverageCost({
      existingQuantity: 100,
      existingAverageCost: 10,
      incomingQuantity: 100,
      incomingCostPerUnit: 14,
    });
    expect(result).toBe(12);
  });

  it("weights by quantity, not a simple average", () => {
    const result = calculateWeightedAverageCost({
      existingQuantity: 900,
      existingAverageCost: 10,
      incomingQuantity: 100,
      incomingCostPerUnit: 20,
    });
    expect(result).toBeCloseTo(11); // (900*10 + 100*20) / 1000 = 11
  });

  it("falls back to the incoming cost when there is no existing stock", () => {
    expect(
      calculateWeightedAverageCost({
        existingQuantity: 0,
        existingAverageCost: 0,
        incomingQuantity: 50,
        incomingCostPerUnit: 7,
      }),
    ).toBe(7);
  });
});
