import { z } from "zod";
import { BOUNDS, idempotencyKeySchema } from "./bounds";

export const adjustmentInputSchema = z.object({
  ingredientId: z.string().uuid(),
  direction: z.enum(["in", "out"]),
  quantityBaseUnits: z.coerce.number().positive("Quantity must be greater than zero").max(BOUNDS.maxQuantity, "Quantity is too large"),
  reason: z.string().trim().min(1, "Reason is required").max(500),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  idempotencyKey: idempotencyKeySchema,
});

export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
