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
