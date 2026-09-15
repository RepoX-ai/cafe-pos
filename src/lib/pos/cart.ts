import { z } from "zod";

export const cartLineSchema = z.object({
  key: z.string(), menuItemId: z.string().uuid(), menuItemName: z.string(),
  variantId: z.string().uuid().nullable(), variantName: z.string().nullable(),
  unitBasePrice: z.number().int().nonnegative(), modifierAdjustmentTotal: z.number().int(),
  modifierOptionIds: z.array(z.string().uuid()), modifierNames: z.array(z.string()),
  quantity: z.number().int().positive(), notes: z.string().optional(),
});
export const cartDraftSchema = z.object({
  cart: z.array(cartLineSchema), orderType: z.enum(["dine_in", "takeaway", "other"]),
  tableLabel: z.string(), discountTotal: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1), paymentMethod: z.enum(["cash", "card", "qris", "other"]),
  cardBank: z.enum(["bca", "mandiri", "bri"]).nullable(),
  cashReceived: z.number().int().nonnegative().nullable().default(null),
});
export function cartLineSignature(line: { menuItemId: string; variantId: string | null; modifierOptionIds: string[]; notes?: string }) {
  return JSON.stringify([line.menuItemId, line.variantId, [...line.modifierOptionIds].sort(), line.notes ?? ""]);
}
