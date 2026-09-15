import type { ConfiguredLine } from "./item-modal";

/** Order options and cart shapes shared by the POS client and its panels. */
export interface CartLine extends ConfiguredLine {
  key: string;
}

export type OrderType = "dine_in" | "takeaway" | "other";
export const PAYMENT_METHODS = ["cash", "card", "qris", "other"] as const;
export const CARD_BANKS = ["bca", "mandiri", "bri"] as const;
export const CARD_BANK_LABELS: Record<(typeof CARD_BANKS)[number], string> = {
  bca: "BCA",
  mandiri: "Mandiri",
  bri: "BRI",
};
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type CardBank = (typeof CARD_BANKS)[number];

/**
 * Quick-tender shortcuts on a cash sale. "exact" tracks the running total
 * rather than a fixed amount, so adding an item after tapping it keeps the
 * tender correct; the presets are the notes a customer actually hands over.
 * "custom" opens the free-entry field. Null means nothing picked yet, which
 * is what blocks submission.
 */
export const CASH_TENDER_MODES = ["exact", "50000", "100000", "custom"] as const;
export type CashTenderMode = (typeof CASH_TENDER_MODES)[number];

export const CASH_TENDER_LABELS: Record<CashTenderMode, string> = {
  exact: "Uang pas",
  "50000": "50.000",
  "100000": "100.000",
  custom: "Lainnya",
};

/** The fixed amount a mode tenders, or null when it depends on the cart. */
export function cashTenderPreset(mode: CashTenderMode): number | null {
  return mode === "exact" || mode === "custom" ? null : Number(mode);
}

/**
 * The amount actually tendered for a mode. Derived at render rather than
 * copied into state so "Uang pas" can't go stale when the cart changes.
 */
export function resolveCashReceived(
  mode: CashTenderMode | null,
  customCash: number | null,
  total: number,
): number | null {
  if (mode === null) return null;
  if (mode === "exact") return total;
  if (mode === "custom") return customCash;
  return cashTenderPreset(mode);
}

export function cartLineTotal(line: CartLine) {
  return (line.unitBasePrice + line.modifierAdjustmentTotal) * line.quantity;
}
