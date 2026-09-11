import { describe, expect, it } from "vitest";
import { convertToBaseUnits } from "@/lib/units/units";

describe("units", () => {
  it("converts kilograms of coffee beans to grams", () => {
    // PRD §6.4 worked example: 2kg -> 2000g
    expect(
      convertToBaseUnits({ quantityPurchased: 2, conversionToBaseUnits: 1000 }),
    ).toBe(2000);
  });

  it("converts litres of milk to millilitres", () => {
    expect(
      convertToBaseUnits({ quantityPurchased: 5, conversionToBaseUnits: 1000 }),
    ).toBe(5000);
  });

  it("converts boxes of cups to pieces", () => {
    expect(
      convertToBaseUnits({ quantityPurchased: 3, conversionToBaseUnits: 12 }),
    ).toBe(36);
  });

  it("rejects zero or negative purchased quantity", () => {
    expect(() =>
      convertToBaseUnits({ quantityPurchased: 0, conversionToBaseUnits: 1000 }),
    ).toThrow();
    expect(() =>
      convertToBaseUnits({ quantityPurchased: -1, conversionToBaseUnits: 1000 }),
    ).toThrow();
  });

  it("rejects zero or negative conversion factor", () => {
    expect(() =>
      convertToBaseUnits({ quantityPurchased: 2, conversionToBaseUnits: 0 }),
    ).toThrow();
  });
});
