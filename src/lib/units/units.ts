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

/**
 * Base-unit quantities are stored as `numeric(16, 4)`. Stock arithmetic
 * that feeds the ledger works on those same ten-thousandths as bigint, so
 * summing many movements never picks up binary floating-point drift.
 */
const QUANTITY_SCALE = 10_000n;

/** Quantity -> ten-thousandths of a base unit, rounded half away from zero (as Postgres numeric does). */
export function toQuantityUnits(value: number | string): bigint {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid quantity: ${value}`);
    return BigInt(Math.sign(value) * Math.round(Math.abs(value) * 10_000));
  }
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (match[2] === "" && !match[3])) throw new Error(`Invalid quantity: ${value}`);
  const fraction = match[3] ?? "";
  let units = BigInt(match[2] || "0") * QUANTITY_SCALE + BigInt((fraction + "0000").slice(0, 4));
  if (fraction.length > 4 && Number(fraction[4]) >= 5) units += 1n;
  return match[1] ? -units : units;
}

/** Ten-thousandths of a base unit -> the decimal string Postgres numeric accepts. */
export function formatQuantityUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const fraction = (abs % QUANTITY_SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / QUANTITY_SCALE}${fraction ? `.${fraction}` : ""}`;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
