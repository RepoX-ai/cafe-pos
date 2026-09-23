import { z } from "zod";
import { BOUNDS, idempotencyKeySchema } from "./bounds";

export const stockCountLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  countedQuantity: z.coerce.number().min(0, "Counted quantity cannot be negative").max(BOUNDS.maxQuantity, "Quantity is too large"),
});

export const stockCountInputSchema = z.object({
  lines: z
    .array(stockCountLineInputSchema)
    .min(1, "Count at least one ingredient")
    .max(BOUNDS.stockCountLines, `A count can have at most ${BOUNDS.stockCountLines} lines`),
  idempotencyKey: idempotencyKeySchema,
});

export type StockCountInput = z.infer<typeof stockCountInputSchema>;
