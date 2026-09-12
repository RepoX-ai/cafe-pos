import { z } from "zod";

export const baseUnitSchema = z.enum(["gram", "millilitre", "piece"]);

export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  sku: z.string().trim().max(100).optional().or(z.literal("")),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  baseUnit: baseUnitSchema,
  reorderLevelBaseUnits: z.coerce.number().min(0).optional(),
  targetStockBaseUnits: z.coerce.number().min(0).optional(),
  startingCostPerBaseUnit: z.coerce.number().min(0).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type IngredientInput = z.infer<typeof ingredientInputSchema>;
