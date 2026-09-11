/**
 * Ingredient base units (PRD §1.7): grams for weight, millilitres for
 * volume, pieces for countable items. Purchases may arrive in a different
 * unit (kg, litre, box, ...); the conversion factor into base units is
 * entered per purchase line and stored alongside it, never hardcoded here.
 */

export type BaseUnit = "gram" | "millilitre" | "piece";

export interface UnitConversionInput {
  quantityPurchased: number;
  conversionToBaseUnits: number; // e.g. 1kg -> 1000 (grams per purchased unit)
}

export function convertToBaseUnits({
  quantityPurchased,
  conversionToBaseUnits,
}: UnitConversionInput): number {
  if (quantityPurchased <= 0) {
    throw new Error("quantityPurchased must be greater than zero");
  }
  if (conversionToBaseUnits <= 0) {
    throw new Error("conversionToBaseUnits must be greater than zero");
  }
  return round(quantityPurchased * conversionToBaseUnits, 4);
}

/** Common conversion factors, offered as UI shortcuts — not enforced. */
export const COMMON_CONVERSIONS: Record<BaseUnit, Record<string, number>> = {
  gram: { kg: 1000, gram: 1 },
  millilitre: { litre: 1000, ml: 1 },
  piece: { box_of_12: 12, box_of_24: 24, piece: 1 },
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
