import { z } from "zod";

export const orderLineInputSchema = z.object({
  menuItemId: z.string().uuid(),
  // Absent when the item has no variants and is sold directly off its
  // base price (see menu-service.getPosMenu / order-service.submitOrder).
  menuItemVariantId: z.string().uuid().nullish(),
  quantity: z.number().int().positive(),
  modifierOptionIds: z.array(z.string().uuid()).default([]),
  notes: z.string().trim().max(500).optional(),
});

export const submitOrderInputSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  orderType: z.enum(["dine_in", "takeaway", "other"]),
  tableLabel: z.string().trim().max(100).optional(),
  paymentMethodLabel: z.string().trim().max(50).optional(),
  discountTotal: z.number().int().min(0).default(0),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(orderLineInputSchema).min(1, "Add at least one item"),
});

export type OrderLineInput = z.infer<typeof orderLineInputSchema>;
export type SubmitOrderInput = z.infer<typeof submitOrderInputSchema>;

export const cancelOrderInputSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required").max(500),
});
