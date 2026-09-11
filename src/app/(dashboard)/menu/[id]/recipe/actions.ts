"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { recipeInputSchema } from "@/lib/validation/recipe";
import { saveRecipe } from "@/server/services/recipe-service";

export type SaveRecipeResult = { ok: true } | { ok: false; error: string };

export async function saveRecipeAction(
  menuItemId: string,
  input: unknown,
): Promise<SaveRecipeResult> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "recipes:write");

  const parsed = recipeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid recipe." };
  }

  try {
    await saveRecipe(db, { businessId: user.businessId, userId: user.id }, parsed.data);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  revalidatePath(`/menu/${menuItemId}/recipe`);
  return { ok: true };
}
