import { describe, expect, it } from "vitest";
import { convertToBaseUnits, purchaseUnitOptionsFor } from "@/lib/units/units";

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

describe("purchaseUnitOptionsFor", () => {
  it("leads with the ingredient's own unit class, so the default is sensible", () => {
    expect(purchaseUnitOptionsFor("gram")[0]).toMatchObject({ unit: "kg", conversionToBaseUnits: 1000 });
    expect(purchaseUnitOptionsFor("millilitre")[0]).toMatchObject({ unit: "L", conversionToBaseUnits: 1000 });
    expect(purchaseUnitOptionsFor("piece")[0]).toMatchObject({ unit: "pc", conversionToBaseUnits: 1 });
  });

  it("offers every unit on every ingredient", () => {
    for (const baseUnit of ["gram", "millilitre", "piece"] as const) {
      expect(purchaseUnitOptionsFor(baseUnit).map((o) => o.unit).sort()).toEqual(["L", "g", "kg", "ml", "pc"]);
    }
  });

  it("labels each option by what the unit itself means", () => {
    const labelFor = (baseUnit: Parameters<typeof purchaseUnitOptionsFor>[0], unit: string) =>
      purchaseUnitOptionsFor(baseUnit).find((o) => o.unit === unit)?.label;
    expect(labelFor("gram", "kg")).toBe("kg (1.000 g)");
    expect(labelFor("gram", "g")).toBe("gram");
    expect(labelFor("gram", "L")).toBe("L (1.000 ml)");
    expect(labelFor("gram", "ml")).toBe("ml");
    expect(labelFor("gram", "pc")).toBe("pcs");
    // The label describes the unit, not the ingredient, so it never varies.
    expect(labelFor("piece", "L")).toBe(labelFor("gram", "L"));
  });
});
