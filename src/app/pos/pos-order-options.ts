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

export function cartLineTotal(line: CartLine) {
  return (line.unitBasePrice + line.modifierAdjustmentTotal) * line.quantity;
}
