/**
 * Money handling for Indonesian Rupiah (IDR).
 *
 * Rule (PRD §1.6): money is always a whole-Rupiah integer — never a
 * JavaScript `float`. IDR has no minor unit in practice (no sen in
 * circulation), so "smallest currency unit" == 1 Rupiah == 1 integer.
 *
 * Internal calculations (percentage discounts, tax, recipe-cost
 * apportionment) still need sub-Rupiah precision to avoid rounding drift
 * when applied across many lines. Rather than touching floats at all, we
 * scale to an integer "micro-Rupiah" space (1 Rupiah = 1_000_000 micros),
 * do all arithmetic in bigint, and only round back to whole Rupiah at the
 * point a value is actually persisted or displayed.
 */

import { purchaseScaleFor, type BaseUnit } from "@/lib/units/units";

const MICROS_PER_RUPIAH = 1_000_000n;

export type Rupiah = number; // whole-Rupiah integer, safe to persist/display
export type Micros = bigint; // internal fixed-point representation

export function rupiahToMicros(amount: Rupiah): Micros {
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid Rupiah amount: ${amount}`);
  }
  return BigInt(Math.round(amount)) * MICROS_PER_RUPIAH;
}

/** Round-half-up to the nearest whole Rupiah. */
export function microsToRupiah(micros: Micros): Rupiah {
  const whole = micros / MICROS_PER_RUPIAH;
  const remainder = micros % MICROS_PER_RUPIAH;
  // Round half up regardless of sign of remainder relative to zero.
  const half = MICROS_PER_RUPIAH / 2n;
  if (remainder >= half) return Number(whole + 1n);
  if (remainder <= -half) return Number(whole - 1n);
  return Number(whole);
}

/**
 * Multiply an exact decimal quantity (e.g. recipe grams, as a string or
 * number) by a decimal cost-per-unit rate, returning micro-Rupiah. Both
 * inputs are parsed at a fixed internal precision to stay exact for the
 * ranges this app deals with (quantities up to ~10^10, rates up to
 * ~10^10) — comfortably inside bigint / Number.isSafeInteger bounds.
 */
export function multiplyQuantityByRate(quantity: number | string, ratePerUnit: number | string): Micros {
  const SCALE = 1_000_000n; // 6 decimal places of precision for both inputs
  const q = toScaledBigInt(quantity, SCALE);
  const r = toScaledBigInt(ratePerUnit, SCALE);
  // (q/SCALE) * (r/SCALE) rupiah = q*r / SCALE^2 rupiah = q*r*MICROS/SCALE^2 micros
  return (q * r * MICROS_PER_RUPIAH) / (SCALE * SCALE);
}

function toScaledBigInt(value: number | string, scale: bigint): bigint {
  const str = typeof value === "number" ? value.toString() : value;
  const [intPart, fracPart = ""] = str.split(".");
  const scaleDigits = scale.toString().length - 1;
  const frac = (fracPart + "0".repeat(scaleDigits)).slice(0, scaleDigits);
  const sign = intPart.startsWith("-") ? -1n : 1n;
  const cleanInt = intPart.replace("-", "") || "0";
  return sign * (BigInt(cleanInt) * scale + BigInt(frac || "0"));
}

export function sumMicros(values: Micros[]): Micros {
  return values.reduce((acc, v) => acc + v, 0n);
}

export function sumRupiah(values: Rupiah[]): Rupiah {
  return values.reduce((acc, v) => acc + Math.round(v), 0);
}

/** Apply a percentage (e.g. 10 for 10%) to a Rupiah amount, rounded to whole Rupiah. */
export function applyPercentage(amount: Rupiah, percent: number): Rupiah {
  const micros = rupiahToMicros(amount);
  const scaledPercent = BigInt(Math.round(percent * 1_000_000));
  const result = (micros * scaledPercent) / (100_000_000n);
  return microsToRupiah(result);
}

export function formatIDR(amount: Rupiah): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  })
    .format(amount)
    .replace(/\s/g, ""); // Intl inserts "Rp 25.000"; PRD wants "Rp25.000"
}

/**
 * Rupiah-per-base-unit rates (e.g. average ingredient cost) are exact
 * decimals, not transacted amounts, so they keep up to two fraction digits
 * instead of rounding to a whole Rupiah.
 */
export function formatIDRRate(rate: number | string): string {
  return `Rp${Number(rate).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
}

/**
 * The same rate rendered at the scale the ingredient is purchased in —
 * "Rp913.560 / kg" rather than "Rp913,56" — so it can be read against a
 * supplier invoice without mental arithmetic. Display only: the stored
 * rate and all costing arithmetic stay per base unit.
 */
export function formatIDRRatePerPurchaseUnit(rate: number | string, baseUnit: BaseUnit): string {
  const { baseUnitsPer, label } = purchaseScaleFor(baseUnit);
  return `${formatIDRRate(Number(rate) * baseUnitsPer)} / ${label}`;
}

/**
 * Converts a PostgreSQL `bigint` aggregate (node-postgres returns it as a
 * string) to a JS number, refusing values outside the safe-integer range
 * rather than silently losing precision. Money columns are `integer`, but a
 * SUM over them can exceed 2^31, so aggregates are cast to bigint in SQL.
 */
export function toSafeInteger(value: string | number | bigint | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const exact = typeof value === "bigint" ? value : BigInt(value);
  if (exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`Aggregate ${exact} is outside the safe integer range`);
  }
  return Number(exact);
}

/** Whole-Rupiah average, rounded half up with exact integer arithmetic. */
export function averageRupiah(total: Rupiah, count: number): Rupiah {
  if (count <= 0) return 0;
  const numerator = BigInt(total) * 2n + (total >= 0 ? BigInt(count) : -BigInt(count));
  return Number(numerator / (2n * BigInt(count)));
}

/** Safe division for margins: returns null when the denominator is zero. */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/** Gross margin percentage, or null if net sales is zero (render as em dash). */
export function grossMarginPercentage(grossProfit: Rupiah, netSales: Rupiah): number | null {
  const ratio = safeDivide(grossProfit, netSales);
  if (ratio === null) return null;
  return Math.round(ratio * 100 * 100) / 100; // 2 decimal places
}
