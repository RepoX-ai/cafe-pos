/**
 * Display form of the snapshot `orders.payment_method_label` — "qris" →
 * "QRIS", "card (BCA)" → "Card (BCA)". Orders submitted without one show "—".
 */
export function formatPaymentMethod(label: string | null) {
  if (!label) return "—";
  if (label.toLowerCase() === "qris") return "QRIS";
  return label.charAt(0).toUpperCase() + label.slice(1);
}
