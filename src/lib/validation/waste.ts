import { z } from "zod";
import { BOUNDS, idempotencyKeySchema } from "./bounds";

export const wasteReasonSchema = z.enum([
  "expired",
  "spilled",
  "damaged",
  "preparation_waste",
  "incorrect_preparation",
  "other",
]);

export const wasteInputSchema = z.object({
  ingredientId: z.string().uuid(),
  quantityBaseUnits: z.coerce.number().positive("Quantity must be greater than zero").max(BOUNDS.maxQuantity, "Quantity is too large"),
  reason: wasteReasonSchema,
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  idempotencyKey: idempotencyKeySchema,
});

export type WasteInput = z.infer<typeof wasteInputSchema>;
