import { z } from "zod";

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
  quantityBaseUnits: z.coerce.number().positive("Quantity must be greater than zero"),
  reason: wasteReasonSchema,
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type WasteInput = z.infer<typeof wasteInputSchema>;
