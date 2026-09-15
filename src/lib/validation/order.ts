import { z } from "zod";

/**
 * Practical upper bounds for one checkout. A café ticket is a handful of
 * lines; these only stop malformed or abusive payloads from making the
 * server validate, cost, and lock an unbounded cart. `maxRupiah` is the
 * PostgreSQL `integer` ceiling every order money column is stored in.
 */
export const ORDER_LIMITS = {
  maxLines: 100,
  maxModifiersPerLine: 20,
  maxQuantityPerLine: 999,
  maxRupiah: 2_147_483_647,
} as const;

export const orderLineInputSchema = z.object({
  menuItemId: z.string().uuid(),
  // Absent when the item has no variants and is sold directly off its
  // base price (see menu-service.getPosMenu / order-service.submitOrder).
  menuItemVariantId: z.string().uuid().nullish(),
  quantity: z
    .number()
    .int()
    .positive()
    .max(ORDER_LIMITS.maxQuantityPerLine, `A line can have at most ${ORDER_LIMITS.maxQuantityPerLine} units.`),
  modifierOptionIds: z
    .array(z.string().uuid())
    .max(ORDER_LIMITS.maxModifiersPerLine, "Too many modifiers on one item.")
    .refine((ids) => new Set(ids).size === ids.length, "Each modifier can only be selected once per item.")
    .default([]),
  notes: z.string().trim().max(500).optional(),
});

export const submitOrderInputSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  orderType: z.enum(["dine_in", "takeaway", "other"]),
  tableLabel: z.string().trim().max(100).optional(),
  paymentMethodLabel: z.string().trim().max(50).optional(),
  discountTotal: z.number().int().min(0).max(ORDER_LIMITS.maxRupiah).default(0),
  notes: z.string().trim().max(1000).optional(),
  lines: z
    .array(orderLineInputSchema)
    .min(1, "Add at least one item")
    .max(ORDER_LIMITS.maxLines, `An order can have at most ${ORDER_LIMITS.maxLines} lines.`),
});

export type OrderLineInput = z.infer<typeof orderLineInputSchema>;
export type SubmitOrderInput = z.infer<typeof submitOrderInputSchema>;

export const cancelOrderInputSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required").max(500),
});
