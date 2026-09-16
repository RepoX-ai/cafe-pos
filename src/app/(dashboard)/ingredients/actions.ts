"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { getRequestMeta } from "@/lib/http/request-meta";
import { ingredientInputSchema, ingredientUpdateSchema } from "@/lib/validation/ingredient";
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
  const user = await requireCurrentUser();
  requirePermission(user.roles, "ingredients:write");

  const parsed = ingredientInputSchema.safeParse(readIngredientForm(formData));
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  const meta = await getRequestMeta();
  await createIngredient(db, { businessId: user.businessId, userId: user.id, ...meta }, parsed.data);
  revalidatePath("/ingredients");
  return { ok: true };
}

export async function updateIngredientAction(
  _prevState: IngredientFormState,
  formData: FormData,
): Promise<IngredientFormState> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "ingredients:write");

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
}

export async function setIngredientActiveAction(formData: FormData): Promise<void> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "ingredients:write");

  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  if (!id) throw new Error("Missing ingredient id.");

  const meta = await getRequestMeta();
  await setIngredientActive(db, { businessId: user.businessId, userId: user.id, ...meta }, id, active);
  revalidatePath("/ingredients");
}

/**
 * Permanent delete, as opposed to the archive toggle above. Stock and cost
 * history survives via the snapshot columns on the history tables; the
 * ingredient does drop out of any recipe using it, which the confirm
 * dialog warns about first.
 */
export async function deleteIngredientAction(formData: FormData): Promise<void> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "ingredients:write");

  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing ingredient id.");

  const meta = await getRequestMeta();
  await deleteIngredient(db, { businessId: user.businessId, userId: user.id, ...meta }, id);
  revalidatePath("/ingredients");
  revalidatePath("/inventory");
}

function flattenZodErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
