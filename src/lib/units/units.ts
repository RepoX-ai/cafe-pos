/**
 * Ingredient base units (PRD §1.7): grams for weight, millilitres for
 * volume, pieces for countable items. Purchases may arrive in a different
 * unit (kg, litre, box, ...); the conversion factor into base units is
 * entered per purchase line and stored alongside it, never hardcoded here.
 */

export type BaseUnit = "gram" | "millilitre" | "piece";

/** Short label for a base unit: "125 g", "50 ml", "2 pc". */
export const BASE_UNIT_LABEL: Record<BaseUnit, string> = { gram: "g", millilitre: "ml", piece: "pc" };

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

/**
 * A base unit is too fine a scale to read a *cost* in: "Rp0,02" per
 * millilitre is nothing you can check against a supplier invoice, and two
 * fraction digits collapse most gram/millilitre rates to a single digit.
 * Costs are therefore displayed at the scale the ingredient is bought in —
 * per kg, per litre, per piece — while every stored value and every
 * costing calculation stays per base unit.
 */
export interface PurchaseScale {
  /** Base units in one displayed unit: 1000 grams per kg. */
  baseUnitsPer: number;
  label: string;
}

const PURCHASE_SCALE: Record<BaseUnit, PurchaseScale> = {
  gram: { baseUnitsPer: 1000, label: "kg" },
  millilitre: { baseUnitsPer: 1000, label: "L" },
  piece: { baseUnitsPer: 1, label: "pc" },
};

export function purchaseScaleFor(baseUnit: BaseUnit): PurchaseScale {
  return PURCHASE_SCALE[baseUnit];
}

/**
 * The units a purchase can be entered in. Staff see all of them on every
 * ingredient, so the list never hides the unit an invoice is written in,
 * and each is labelled by what the unit itself means. The ingredient's own
 * class is ordered first so the preselected default is the sensible one;
 * the running "adds N to stock" hint on the entry row is what catches a
 * cross-class pick. The chosen factor is stored per purchase line, so
 * nothing here is baked into historical rows.
 */
export interface PurchaseUnitOption {
  unit: string;
  label: string;
  conversionToBaseUnits: number;
}

const PURCHASE_UNITS: (PurchaseUnitOption & { nativeBase: BaseUnit })[] = [
  { unit: "kg", label: "kg (1.000 g)", nativeBase: "gram", conversionToBaseUnits: 1000 },
  { unit: "g", label: "gram", nativeBase: "gram", conversionToBaseUnits: 1 },
  { unit: "L", label: "L (1.000 ml)", nativeBase: "millilitre", conversionToBaseUnits: 1000 },
  { unit: "ml", label: "ml", nativeBase: "millilitre", conversionToBaseUnits: 1 },
  { unit: "pc", label: "pcs", nativeBase: "piece", conversionToBaseUnits: 1 },
];

export function purchaseUnitOptionsFor(baseUnit: BaseUnit): PurchaseUnitOption[] {
  return [
    ...PURCHASE_UNITS.filter((u) => u.nativeBase === baseUnit),
    ...PURCHASE_UNITS.filter((u) => u.nativeBase !== baseUnit),
  ].map(({ unit, label, conversionToBaseUnits }) => ({ unit, label, conversionToBaseUnits }));
}

/**
 * The unit an ingredient's stock is shown and entered in — kg of chicken,
 * L of milk — chosen per ingredient. Display only: quantities are stored,
 * locked and costed in the base unit, and converted at the edge of the UI.
 * Recipes, purchases and order consumption don't use it; recipe quantities
 * are per serving and read naturally in g / ml.
 */
export type DisplayUnit = "kg" | "g" | "L" | "ml" | "pc";

const DISPLAY_UNITS: Record<DisplayUnit, { baseUnit: BaseUnit; decimalShift: number; option: string }> = {
  kg: { baseUnit: "gram", decimalShift: 3, option: "kg (weight)" },
  g: { baseUnit: "gram", decimalShift: 0, option: "gram (weight)" },
  L: { baseUnit: "millilitre", decimalShift: 3, option: "L (volume)" },
  ml: { baseUnit: "millilitre", decimalShift: 0, option: "ml (volume)" },
  pc: { baseUnit: "piece", decimalShift: 0, option: "pcs (countable)" },
};

export const DISPLAY_UNIT_OPTIONS: { value: DisplayUnit; label: string }[] = (
  Object.keys(DISPLAY_UNITS) as DisplayUnit[]
).map((value) => ({ value, label: DISPLAY_UNITS[value].option }));

const DEFAULT_DISPLAY_UNIT: Record<BaseUnit, DisplayUnit> = { gram: "g", millilitre: "ml", piece: "pc" };

export function baseUnitOfDisplayUnit(unit: DisplayUnit): BaseUnit {
  return DISPLAY_UNITS[unit].baseUnit;
}

/** The display units that can stand for a base unit: kg and g for gram. */
export function displayUnitsFor(baseUnit: BaseUnit): DisplayUnit[] {
  return (Object.keys(DISPLAY_UNITS) as DisplayUnit[]).filter((unit) => DISPLAY_UNITS[unit].baseUnit === baseUnit);
}

/** The stored display unit, or the base unit's own when unset or from the wrong class. */
export function resolveDisplayUnit(baseUnit: BaseUnit, displayUnit: DisplayUnit | null | undefined): DisplayUnit {
  return displayUnit && DISPLAY_UNITS[displayUnit].baseUnit === baseUnit ? displayUnit : DEFAULT_DISPLAY_UNIT[baseUnit];
}

/** Moves the decimal point of a plain decimal string without going through a float. */
function shiftDecimal(value: string, places: number): string {
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (match[2] === "" && !match[3])) throw new Error(`Invalid quantity: ${value}`);
  const [, sign = "", whole, fraction = ""] = match;
  const digits = whole + fraction;
  let point = whole.length + places;
  const padded = point < 0 ? "0".repeat(-point) + digits : digits.padEnd(point, "0");
  if (point < 0) point = 0;
  const intPart = padded.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const fracPart = padded.slice(point).replace(/0+$/, "");
  const result = fracPart ? `${intPart}.${fracPart}` : intPart;
  return sign && /[1-9]/.test(result) ? `-${result}` : result;
}

/** "2.4" typed in kg -> "2400" grams. Exact. */
export function displayToBaseQuantity(value: string | number, unit: DisplayUnit): string {
  return shiftDecimal(String(value), DISPLAY_UNITS[unit].decimalShift);
}

/** "2400" grams -> "2.4" in kg. Exact; for prefilling inputs. */
export function baseToDisplayQuantity(value: string | number, unit: DisplayUnit): string {
  return shiftDecimal(String(value), -DISPLAY_UNITS[unit].decimalShift);
}

/** "2,4 kg" — a base-unit quantity formatted in the ingredient's display unit. */
export function formatDisplayQuantity(value: string | number, unit: DisplayUnit): string {
  const amount = Number(baseToDisplayQuantity(value, unit)).toLocaleString("id-ID", {
    // A sale deducts 18 g; in kg that is 0,018 — keep enough digits to show it.
    maximumFractionDigits: 2 + DISPLAY_UNITS[unit].decimalShift,
  });
  return `${amount} ${unit}`;
}
