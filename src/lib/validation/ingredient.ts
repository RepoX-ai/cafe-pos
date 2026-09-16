import { z } from "zod";

export const baseUnitSchema = z.enum(["gram", "millilitre", "piece"]);
export const displayUnitSchema = z.enum(["kg", "g", "L", "ml", "pc"]);

export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  sku: z.string().trim().max(100).optional().or(z.literal("")),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  baseUnit: baseUnitSchema,
  // Checked against the base unit's class in the service, where the stored
  // base unit is known on edit too.
  displayUnit: displayUnitSchema.optional(),
  reorderLevelBaseUnits: z.coerce.number().min(0).optional(),
  targetStockBaseUnits: z.coerce.number().min(0).optional(),
  // Entered the way the ingredient is bought and the list shows it — per
  // kg / per litre / per piece — not per base unit. The service converts.
  startingCostPerPurchaseUnit: z.coerce.number().int("Enter a whole Rupiah amount").min(0).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type IngredientInput = z.infer<typeof ingredientInputSchema>;

/**
 * Editing never accepts a base unit. Every stored quantity, recipe line and
 * cost rate for the ingredient is expressed in that unit, so changing it
 * would silently reinterpret all of them (gram → piece turns 500 g into 500
 * pieces). The server keeps the stored unit rather than trusting the form.
 */
export const ingredientUpdateSchema = ingredientInputSchema.omit({ baseUnit: true });

export type IngredientUpdateInput = z.infer<typeof ingredientUpdateSchema>;
