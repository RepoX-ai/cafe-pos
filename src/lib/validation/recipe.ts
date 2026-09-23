import { z } from "zod";
import { BOUNDS } from "./bounds";

export const recipeLineInputSchema = z.object({
  ingredientId: z.string().uuid(),
  quantityBaseUnits: z.coerce.number().positive("Quantity must be greater than zero").max(BOUNDS.maxQuantity, "Quantity is too large"),
  wastePercentage: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

function rejectDuplicateIngredients(data: { lines: Array<{ ingredientId: string }> }, ctx: z.RefinementCtx) {
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
}

export const recipeInputSchema = z
  .object({
    menuItemVariantId: z.string().uuid(),
    lines: z.array(recipeLineInputSchema).min(1, "Add at least one ingredient").max(BOUNDS.recipeLines, `A recipe can have at most ${BOUNDS.recipeLines} ingredients`),
  })
  .superRefine(rejectDuplicateIngredients);

/** An add-on's ingredient lines. Empty is allowed: options like "Extra sweet" may use no tracked stock. */
export const modifierRecipeInputSchema = z
  .object({
    groupId: z.string().uuid(),
    optionId: z.string().uuid(),
    lines: z.array(recipeLineInputSchema.omit({ notes: true })).max(BOUNDS.recipeLines, `An option can have at most ${BOUNDS.recipeLines} ingredients`),
  })
  .superRefine(rejectDuplicateIngredients);

export type RecipeInput = z.infer<typeof recipeInputSchema>;
export type ModifierRecipeInput = z.infer<typeof modifierRecipeInputSchema>;
export type RecipeLineInput = z.infer<typeof recipeLineInputSchema>;
