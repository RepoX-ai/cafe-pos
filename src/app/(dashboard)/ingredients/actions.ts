"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import { ServiceError } from "@/server/services/errors";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { asActionResult } from "@/lib/permissions/action-result";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";
import { requirePermission } from "@/lib/permissions/permissions";
import { getRequestMeta } from "@/lib/http/request-meta";
import { ingredientInputSchema, ingredientUpdateSchema } from "@/lib/validation/ingredient";
import { flattenZodErrors } from "@/lib/validation/form-errors";
import {
  createIngredient,
  deleteIngredient,
  IngredientValidationError,
  setIngredientActive,
  updateIngredient,
} from "@/server/services/ingredient-service";

export type IngredientFormState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

function readIngredientForm(formData: FormData) {
  return {
    name: formData.get("name"),
    sku: formData.get("sku"),
    category: formData.get("category"),
    baseUnit: formData.get("baseUnit"),
    displayUnit: formData.get("displayUnit") || undefined,
    reorderLevelBaseUnits: formData.get("reorderLevelBaseUnits") || undefined,
    targetStockBaseUnits: formData.get("targetStockBaseUnits") || undefined,
    startingCostPerPurchaseUnit: formData.get("startingCostPerPurchaseUnit") || undefined,
    notes: formData.get("notes"),
  };
}

export async function createIngredientAction(
  _prevState: IngredientFormState,
  formData: FormData,
): Promise<IngredientFormState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "ingredients:write");
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) throw new ServiceError("Too many changes in a short time. Wait a moment and try again.");

    const parsed = ingredientInputSchema.safeParse(readIngredientForm(formData));
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
    }

    const meta = await getRequestMeta();
    try {
      await createIngredient(db, { businessId: user.businessId, userId: user.id, ...meta }, parsed.data);
    } catch (error) {
      if (error instanceof IngredientValidationError) return { ok: false, error: error.message };
      throw error;
    }
    revalidatePath("/ingredients");
    return { ok: true };
  });
}


export async function updateIngredientAction(
  _prevState: IngredientFormState,
  formData: FormData,
): Promise<IngredientFormState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "ingredients:write");
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) throw new ServiceError("Too many changes in a short time. Wait a moment and try again.");

    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, error: "Missing ingredient id." };

    // The base-unit select is disabled on edit, and browsers omit disabled
    // fields from FormData — so baseUnit is absent here by design, not an error.
    const parsed = ingredientUpdateSchema.safeParse(readIngredientForm(formData));
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
    }

    const meta = await getRequestMeta();
    try {
      await updateIngredient(db, { businessId: user.businessId, userId: user.id, ...meta }, id, parsed.data);
    } catch (error) {
      if (error instanceof IngredientValidationError) return { ok: false, error: error.message };
      throw error;
    }
    revalidatePath("/ingredients");
    return { ok: true };
  });
}


export async function setIngredientActiveAction(formData: FormData): Promise<void> {
  const result = await asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "ingredients:write");
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) throw new ServiceError("Too many changes in a short time. Wait a moment and try again.");

    const id = String(formData.get("id") ?? "");
    const active = formData.get("active") === "true";
    if (!id) throw new Error("Missing ingredient id.");

    const meta = await getRequestMeta();
    await setIngredientActive(db, { businessId: user.businessId, userId: user.id, ...meta }, id, active);
    revalidatePath("/ingredients");
  });
  if (result && typeof result === "object" && "ok" in result && result.ok === false) {
    throw new Error(result.error);
  }
}


/**
 * Permanent delete, as opposed to the archive toggle above. Stock and cost
 * history survives via the snapshot columns on the history tables; the
 * ingredient does drop out of any recipe using it, which the confirm
 * dialog warns about first.
 */
export async function deleteIngredientAction(formData: FormData): Promise<void> {
  const result = await asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "ingredients:write");
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) throw new ServiceError("Too many changes in a short time. Wait a moment and try again.");

    const id = String(formData.get("id") ?? "");
    if (!id) throw new Error("Missing ingredient id.");

    const meta = await getRequestMeta();
    await deleteIngredient(db, { businessId: user.businessId, userId: user.id, ...meta }, id);
    revalidatePath("/ingredients");
    revalidatePath("/inventory");
    invalidatePosMenuCache(user.businessId);
  });
  if (result && typeof result === "object" && "ok" in result && result.ok === false) {
    throw new Error(result.error);
  }
}

