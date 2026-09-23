"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import { toUserMessage } from "@/server/services/errors";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { asActionResult } from "@/lib/permissions/action-result";
import { requirePermission } from "@/lib/permissions/permissions";
import { recipeInputSchema } from "@/lib/validation/recipe";
import { saveRecipe } from "@/server/services/recipe-service";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";

export type SaveRecipeResult = { ok: true } | { ok: false; error: string };

export async function saveRecipeAction(
  menuItemId: string,
  input: unknown,
): Promise<SaveRecipeResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "recipes:write");

    const parsed = recipeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid recipe." };
    }
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };

    try {
      await saveRecipe(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    } catch (error) {
      return { ok: false, error: toUserMessage(error, "dashboard/menu/[id]/recipe") };
    }

    revalidatePath(`/menu/${menuItemId}/recipe`);
    invalidatePosMenuCache(user.businessId);
    return { ok: true };
  });
}
