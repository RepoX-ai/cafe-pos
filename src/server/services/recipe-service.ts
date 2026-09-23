import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ingredients, menuItemVariants, menuItems, recipeLines, recipes } from "@/lib/db/schema";
import { calculateRecipeCost } from "@/lib/recipes/cost";
import type { RecipeInput } from "@/lib/validation/recipe";
import { recordAuditLog } from "./audit";
import { NotFoundError, ServiceError } from "./errors";
import type { ActorContext } from "./ingredient-service";
import { lockVariantForRecipe } from "./locks";

export interface RecipeLineView {
  id: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: "gram" | "millilitre" | "piece";
  quantityBaseUnits: string;
  wastePercentage: string | null;
  notes: string | null;
  costPerBaseUnit: string;
  lineCostRupiah: number;
}

export interface ActiveRecipeView {
  recipeId: string;
  version: number;
  lines: RecipeLineView[];
  totalCostRupiah: number;
}

async function assertVariantBelongsToBusiness(db: Database, businessId: string, variantId: string) {
  const [row] = await db
    .select({ id: menuItemVariants.id })
    .from(menuItemVariants)
    .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
    .where(and(eq(menuItemVariants.id, variantId), eq(menuItems.businessId, businessId)))
    .limit(1);
  if (!row) throw new NotFoundError("Menu item variant not found");
}

export async function getActiveRecipe(
  db: Database,
  businessId: string,
  variantId: string,
): Promise<ActiveRecipeView | null> {
  await assertVariantBelongsToBusiness(db, businessId, variantId);

  const [recipe] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.menuItemVariantId, variantId), eq(recipes.active, true)))
    .orderBy(desc(recipes.version))
    .limit(1);

  if (!recipe) return null;

  const lines = await db
    .select({
      id: recipeLines.id,
      ingredientId: recipeLines.ingredientId,
      ingredientName: ingredients.name,
      baseUnit: ingredients.baseUnit,
      quantityBaseUnits: recipeLines.quantityBaseUnits,
      wastePercentage: recipeLines.wastePercentage,
      notes: recipeLines.notes,
      costPerBaseUnit: ingredients.averageCostPerBaseUnit,
    })
    .from(recipeLines)
    .innerJoin(ingredients, and(eq(recipeLines.ingredientId, ingredients.id), eq(ingredients.businessId, businessId)))
    .where(eq(recipeLines.recipeId, recipe.id));

  const withCost: RecipeLineView[] = lines.map((line) => ({
    ...line,
    lineCostRupiah: calculateRecipeCost([
      {
        ingredientId: line.ingredientId,
        quantityBaseUnits: Number(line.quantityBaseUnits),
        wastePercentage: Number(line.wastePercentage ?? 0),
        costPerBaseUnit: line.costPerBaseUnit,
      },
    ]),
  }));

  return {
    recipeId: recipe.id,
    version: recipe.version,
    lines: withCost,
    totalCostRupiah: withCost.reduce((sum, l) => sum + l.lineCostRupiah, 0),
  };
}

/**
 * Recipes are never edited in place. Saving creates a new version and
 * deactivates the previous one, so any order already submitted against the
 * old version keeps its own recipe/cost snapshot untouched (PRD §6.5:
 * "Recipe edits affect future orders only").
 *
 * Concurrency: every save for a variant locks that variant's row first —
 * the only row that exists even before the first recipe does — so two saves
 * run one after the other and each sees the other's version. The unique
 * indexes (one active recipe per variant; unique version per variant) are
 * the backstop if some other writer ever skips the lock.
 */
export async function saveRecipe(db: Database, actor: ActorContext, input: RecipeInput) {
  return db.transaction(async (tx) => {
    await lockVariantForRecipe(tx, actor.businessId, input.menuItemVariantId);

    // Validate every ingredient referenced belongs to this business.
    const ingredientIds = input.lines.map((l) => l.ingredientId);
    const rows = await tx
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(inArray(ingredients.id, ingredientIds), eq(ingredients.businessId, actor.businessId)));
    if (rows.length !== new Set(ingredientIds).size) {
      throw new ServiceError("One or more ingredients are invalid for this business");
    }

    const [{ latestVersion }] = await tx
      .select({ latestVersion: sql<number>`coalesce(max(${recipes.version}), 0)::int` })
      .from(recipes)
      .where(eq(recipes.menuItemVariantId, input.menuItemVariantId));

    const deactivated = await tx
      .update(recipes)
      .set({ active: false })
      .where(and(eq(recipes.menuItemVariantId, input.menuItemVariantId), eq(recipes.active, true)))
      .returning({ id: recipes.id, version: recipes.version });

    const [created] = await tx
      .insert(recipes)
      .values({
        businessId: actor.businessId,
        menuItemVariantId: input.menuItemVariantId,
        version: latestVersion + 1,
        active: true,
        createdBy: actor.userId,
      })
      .returning();

    await tx.insert(recipeLines).values(
      input.lines.map((line) => ({
        businessId: actor.businessId,
        recipeId: created.id,
        ingredientId: line.ingredientId,
        quantityBaseUnits: String(line.quantityBaseUnits),
        wastePercentage: String(line.wastePercentage ?? 0),
        notes: line.notes || null,
      })),
    );

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "recipe.saved",
      entityType: "recipe",
      entityId: created.id,
      metadata: {
        menuItemVariantId: input.menuItemVariantId,
        version: created.version,
        replacedVersions: deactivated.map((r) => r.version),
      },
    });

    return created;
  });
}
