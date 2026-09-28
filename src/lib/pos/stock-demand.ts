import { BASE_UNIT_LABEL, formatQuantityUnits, toQuantityUnits, type BaseUnit } from "@/lib/units/units";

/**
 * Client-side preview of checkout's stock gate, so the POS can say which
 * ingredient is short before the cashier submits. Mirrors order-service:
 * per line, the variant's and every selected modifier's per-unit demand is
 * summed, multiplied by the quantity, then rounded to ten-thousandths; the
 * whole order is compared against stock at once.
 *
 * Advisory only. Stock can change after the page loads, so checkout's own
 * locked, transactional check stays the final word.
 */

/** Per-unit quantity of one ingredient, waste already included, in base units. */
export interface IngredientDemand {
  ingredientId: string;
  quantity: number;
}

export interface IngredientStock {
  name: string;
  unit: BaseUnit;
  /** Exact numeric string from the database, e.g. "100.0000". */
  available: string;
}

export type StockLevels = Record<string, IngredientStock>;

export interface StockShortage {
  ingredientId: string;
  name: string;
  unit: BaseUnit;
  needed: bigint;
  available: bigint;
}

export type DemandTotals = Map<string, bigint>;

/** Adds one order line (variant + modifiers, × quantity) to `totals`. */
export function addLineDemand(totals: DemandTotals, parts: IngredientDemand[][], quantity: number): DemandTotals {
  const perUnit = new Map<string, number>();
  for (const part of parts) {
    for (const d of part) perUnit.set(d.ingredientId, (perUnit.get(d.ingredientId) ?? 0) + d.quantity);
  }
  for (const [ingredientId, quantityPerUnit] of perUnit) {
    totals.set(ingredientId, (totals.get(ingredientId) ?? 0n) + toQuantityUnits(quantityPerUnit * quantity));
  }
  return totals;
}

/** Every ingredient whose total demand exceeds stock. Ingredients without a stock entry are not checked. */
export function findShortages(totals: DemandTotals, stock: StockLevels): StockShortage[] {
  const shortages: StockShortage[] = [];
  for (const [ingredientId, needed] of totals) {
    const level = stock[ingredientId];
    if (!level) continue;
    const available = toQuantityUnits(level.available);
    if (needed > available) shortages.push({ ingredientId, name: level.name, unit: level.unit, needed, available });
  }
  return shortages;
}

export function formatStockQuantity(units: bigint, unit: BaseUnit): string {
  const value = units < 0n ? 0n : units;
  return `${Number(formatQuantityUnits(value)).toLocaleString("id-ID", { maximumFractionDigits: 4 })} ${BASE_UNIT_LABEL[unit]}`;
}

/** "Not enough Beef: needs 120 g, 100 g in stock (20 g short)." */
export function describeShortage(shortage: StockShortage): string {
  const { name, unit, needed, available } = shortage;
  return `Not enough ${name}: needs ${formatStockQuantity(needed, unit)}, ${formatStockQuantity(available, unit)} in stock (${formatStockQuantity(needed - available, unit)} short).`;
}
