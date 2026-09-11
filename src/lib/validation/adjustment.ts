import { z } from "zod";

export const adjustmentInputSchema = z.object({
  ingredientId: z.string().uuid(),
  direction: z.enum(["in", "out"]),
  quantityBaseUnits: z.coerce.number().positive("Quantity must be greater than zero"),
  reason: z.string().trim().min(1, "Reason is required").max(500),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
