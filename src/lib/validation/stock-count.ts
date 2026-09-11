import { z } from "zod";

export const stockCountLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  countedQuantity: z.coerce.number().min(0, "Counted quantity cannot be negative"),
});

export const stockCountInputSchema = z.object({
  lines: z.array(stockCountLineInputSchema).min(1, "Count at least one ingredient"),
});

export type StockCountInput = z.infer<typeof stockCountInputSchema>;
