import { applyPercentage } from "@/lib/money/money";

/**
 * Whether tax is included in menu prices, and whether a service charge
 * applies, are explicitly open decisions per the PRD (§20 #5, #6) —
 * configuration points, not hardcoded assumptions. This module reads
 * whatever the business has configured (via /settings) and computes tax
 * accordingly; with nothing configured, tax and service charge are simply
 * zero rather than guessed at.
 */
export interface TaxConfig {
  percent: number;
  inclusive: boolean;
}

export function parseTaxConfig(raw: string | null): TaxConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.percent === "number") {
      return { percent: parsed.percent, inclusive: Boolean(parsed.inclusive) };
    }
  } catch {
    // ignore malformed config; treat as unconfigured
  }
  return null;
}

export function serializeTaxConfig(config: TaxConfig | null): string | null {
  return config ? JSON.stringify(config) : null;
}

/**
 * Tax on the discounted subtotal. When prices are tax-inclusive, the tax
 * amount is backed out of the subtotal rather than added on top (the
 * subtotal already contains it) — `total` is unaffected either way, but
 * `taxTotal` is reported for transparency.
 */
export function calculateTax(netSales: number, config: TaxConfig | null): number {
  if (!config || config.percent <= 0) return 0;
  if (config.inclusive) {
    // netSales = base + tax, base = netSales / (1 + percent/100)
    const base = netSales / (1 + config.percent / 100);
    return Math.round(netSales - base);
  }
  return applyPercentage(netSales, config.percent);
}

export function calculateServiceCharge(netSales: number, percent: number | null): number {
  if (!percent || percent <= 0) return 0;
  return applyPercentage(netSales, percent);
}

/** Shared by the POS preview and checkout. Service charge uses discounted
 * menu prices, as before; included tax is disclosed, never added twice. */
export function calculateOrderTotals(subtotal: number, discount: number, tax: TaxConfig | null, servicePercent: number | null) {
  const discountTotal = Math.min(discount, subtotal);
  const discountedSubtotal = subtotal - discountTotal;
  const taxTotal = calculateTax(discountedSubtotal, tax);
  const netSales = discountedSubtotal - (tax?.inclusive ? taxTotal : 0);
  const serviceChargeTotal = calculateServiceCharge(discountedSubtotal, servicePercent);
  return { discountTotal, netSales, taxTotal, serviceChargeTotal, total: netSales + taxTotal + serviceChargeTotal };
}

/** Derive the historical mode from saved amounts, never today's settings. */
export function orderTaxIsIncluded(order: { subtotal: number; discountTotal: number; taxTotal: number; serviceChargeTotal: number; total: number }): boolean {
  return order.taxTotal > 0 && order.total === order.subtotal - order.discountTotal + order.serviceChargeTotal;
}
