import { z } from "zod";
import { BOUNDS, calendarDateSchema, idempotencyKeySchema } from "./bounds";

export const purchaseLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  quantityPurchased: z.coerce.number().positive("Quantity must be greater than zero").max(BOUNDS.maxQuantity, "Quantity is too large"),
  purchaseUnit: z.string().trim().min(1, "Unit is required").max(50),
  conversionToBaseUnits: z.coerce.number().positive("Conversion must be greater than zero").max(BOUNDS.maxRate, "Conversion is too large"),
  unitPurchaseCost: z.coerce.number().int().min(0, "Cost cannot be negative").max(BOUNDS.maxInt, "Cost is too large"),
});

export const purchaseInputSchema = z.object({
  supplierId: z.string().uuid().optional().or(z.literal("")),
  invoiceNumber: z.string().trim().max(100).optional().or(z.literal("")),
  purchaseDate: calendarDateSchema,
  lines: z
    .array(purchaseLineInputSchema)
    .min(1, "Add at least one ingredient line")
    .max(BOUNDS.purchaseLines, `A receipt can have at most ${BOUNDS.purchaseLines} lines`),
  idempotencyKey: idempotencyKeySchema,
});

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
export type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;
