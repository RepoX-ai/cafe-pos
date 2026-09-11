import { z } from "zod";

export const purchaseLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  quantityPurchased: z.coerce.number().positive("Quantity must be greater than zero"),
  purchaseUnit: z.string().trim().min(1, "Unit is required").max(50),
  conversionToBaseUnits: z.coerce.number().positive("Conversion must be greater than zero"),
  unitPurchaseCost: z.coerce.number().int().min(0, "Cost cannot be negative"),
});

export const purchaseInputSchema = z.object({
  supplierId: z.string().uuid().optional().or(z.literal("")),
  invoiceNumber: z.string().trim().max(100).optional().or(z.literal("")),
  purchaseDate: z.string().min(1, "Date is required"),
  lines: z.array(purchaseLineInputSchema).min(1, "Add at least one ingredient line"),
});

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
export type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;
