import { z } from "zod";

export const recipeLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  quantityBaseUnits: z.coerce.number().positive("Quantity must be greater than zero"),
  wastePercentage: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export const recipeInputSchema = z
  .object({
    menuItemVariantId: z.string().uuid(),
    lines: z.array(recipeLineInputSchema).min(1, "Add at least one ingredient"),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (const [index, line] of data.lines.entries()) {
      if (seen.has(line.ingredientId)) {
        ctx.addIssue({
          code: "custom",
          message: "This ingredient is already in the recipe",
          path: ["lines", index, "ingredientId"],
        });
      }
      seen.add(line.ingredientId);
    }
  });

export type RecipeInput = z.infer<typeof recipeInputSchema>;
export type RecipeLineInput = z.infer<typeof recipeLineInputSchema>;
