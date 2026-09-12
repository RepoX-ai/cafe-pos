"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import {
  categoryInputSchema,
  menuItemInputSchema,
  modifierGroupInputSchema,
  modifierOptionInputSchema,
  variantInputSchema,
} from "@/lib/validation/menu";
import { recipeLineInputSchema, type RecipeLineInput } from "@/lib/validation/recipe";
import {
  createCategory,
  createMenuItem,
  createVariantWithRecipe,
  createModifierGroup,
  createModifierOption,
  setCategoryActive,
  setItemModifierGroups,
  setMenuItemActive,
  setModifierGroupActive,
  setModifierOptionActive,
  setVariantActive,
  updateMenuItem,
  updateVariant,
} from "@/server/services/menu-service";
import { saveMenuImage } from "@/server/services/menu-image-upload";

export type FormActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

function flattenZodErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

async function actor() {
  const user = await requireCurrentUser();
  return { user, actor: { businessId: user.businessId, userId: user.id } };
}

/**
 * An uploaded file (if any and non-empty) wins over the pasted-URL field.
 * When the form's image field is in "upload" mode but nothing was chosen
 * yet, `imageFile` is absent and the hidden `imageUrl` field carries the
 * item's existing URL through unchanged — never a silent clear.
 */
async function resolveImageUrl(formData: FormData): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const file = formData.get("imageFile");
  if (file instanceof File && file.size > 0) {
    const saved = await saveMenuImage(file);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, imageUrl: saved.url };
  }
  return { ok: true, imageUrl: String(formData.get("imageUrl") || "") };
}

// --- Categories --------------------------------------------------------------

export async function createCategoryAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const parsed = categoryInputSchema.safeParse({
    name: formData.get("name"),
    displayOrder: formData.get("displayOrder") || 0,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  await createCategory(db, ctx, parsed.data);
  revalidatePath("/menu");
  return { ok: true };
}

export async function setCategoryActiveAction(formData: FormData): Promise<void> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  await setCategoryActive(db, ctx, String(formData.get("id")), formData.get("active") === "true");
  revalidatePath("/menu");
}

// --- Menu items ----------------------------------------------------------------

export async function createMenuItemAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const image = await resolveImageUrl(formData);
  if (!image.ok) return { ok: false, error: image.error, fieldErrors: { imageUrl: image.error } };
  const parsed = menuItemInputSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") || "",
    // `|| ""` guards fields a given form may not render at all (e.g. NewItemForm
    // has no description/imageUrl inputs): formData.get() then returns null,
    // which fails these schema fields' `.optional()` (undefined-only, not null).
    description: formData.get("description") || "",
    imageUrl: image.imageUrl,
    basePrice: formData.get("basePrice"),
    taxBehavior: formData.get("taxBehavior") || "exclusive",
    tracksInventory: formData.get("tracksInventory") === "on",
    active: formData.get("active") === "on",
    displayOrder: formData.get("displayOrder") || 0,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const item = await createMenuItem(db, ctx, parsed.data);
  revalidatePath("/menu");
  redirect(`/menu/${item.id}`);
}

export async function updateMenuItemAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const id = String(formData.get("id") ?? "");
  const image = await resolveImageUrl(formData);
  if (!image.ok) return { ok: false, error: image.error, fieldErrors: { imageUrl: image.error } };
  const parsed = menuItemInputSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") || "",
    description: formData.get("description") || "",
    imageUrl: image.imageUrl,
    basePrice: formData.get("basePrice"),
    taxBehavior: formData.get("taxBehavior") || "exclusive",
    tracksInventory: formData.get("tracksInventory") === "on",
    active: formData.get("active") === "on",
    displayOrder: formData.get("displayOrder") || 0,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  await updateMenuItem(db, ctx, id, parsed.data);
  revalidatePath("/menu");
  revalidatePath(`/menu/${id}`);
  return { ok: true };
}

export async function setMenuItemActiveAction(formData: FormData): Promise<void> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const id = String(formData.get("id"));
  await setMenuItemActive(db, ctx, id, formData.get("active") === "true");
  revalidatePath("/menu");
  revalidatePath(`/menu/${id}`);
}

export type CreateVariantWithRecipeResult =
  | { ok: true; variantId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Adds a variant and its recipe in one step, instead of the two separate
 * trips to add a variant and then visit its recipe page.
 * `recipeLines` may be an empty array — same as adding a variant with no
 * recipe yet.
 */
export async function createVariantWithRecipeAction(
  menuItemId: string,
  variantInput: unknown,
  recipeLines: unknown,
): Promise<CreateVariantWithRecipeResult> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");

  const parsedVariant = variantInputSchema.safeParse(variantInput);
  if (!parsedVariant.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsedVariant.error) };
  }

  let lines: RecipeLineInput[] = [];
  const rawLines = Array.isArray(recipeLines) ? recipeLines : [];
  if (rawLines.length > 0) {
    // Recipe lines are a separate permission from creating the variant
    // itself — the UI hides this section without recipes:write, but the
    // server never trusts that alone.
    requirePermission(user.roles, "recipes:write");
    const parsedLines = z.array(recipeLineInputSchema).safeParse(rawLines);
    if (!parsedLines.success) {
      return { ok: false, error: parsedLines.error.issues[0]?.message ?? "Check the recipe ingredients." };
    }
    const seen = new Set<string>();
    for (const line of parsedLines.data) {
      if (seen.has(line.ingredientId)) {
        return { ok: false, error: "This ingredient is already in the recipe." };
      }
      seen.add(line.ingredientId);
    }
    lines = parsedLines.data;
  }

  try {
    const variant = await createVariantWithRecipe(db, ctx, menuItemId, parsedVariant.data, lines);
    revalidatePath(`/menu/${menuItemId}`);
    revalidatePath(`/menu/${menuItemId}/recipe`);
    return { ok: true, variantId: variant.id };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function updateVariantAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const menuItemId = String(formData.get("menuItemId") ?? "");
  const variantId = String(formData.get("variantId") ?? "");
  const parsed = variantInputSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
    active: formData.get("active") === "on",
    displayOrder: formData.get("displayOrder") || 0,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  await updateVariant(db, ctx, menuItemId, variantId, parsed.data);
  revalidatePath(`/menu/${menuItemId}`);
  return { ok: true };
}

export async function setVariantActiveAction(formData: FormData): Promise<void> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const menuItemId = String(formData.get("menuItemId"));
  await setVariantActive(db, ctx, menuItemId, String(formData.get("variantId")), formData.get("active") === "true");
  revalidatePath(`/menu/${menuItemId}`);
}

// --- Modifier groups + options -----------------------------------------------------

export async function createModifierGroupAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const parsed = modifierGroupInputSchema.safeParse({
    name: formData.get("name"),
    required: formData.get("required") === "on",
    minSelections: formData.get("minSelections") || 0,
    maxSelections: formData.get("maxSelections") || 1,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  await createModifierGroup(db, ctx, parsed.data);
  revalidatePath("/menu");
  return { ok: true };
}

export async function setModifierGroupActiveAction(formData: FormData): Promise<void> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  await setModifierGroupActive(db, ctx, String(formData.get("id")), formData.get("active") === "true");
  revalidatePath("/menu");
}

export async function createModifierOptionAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const groupId = String(formData.get("groupId") ?? "");
  const parsed = modifierOptionInputSchema.safeParse({
    name: formData.get("name"),
    priceAdjustment: formData.get("priceAdjustment") || 0,
    active: true,
    displayOrder: formData.get("displayOrder") || 0,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  await createModifierOption(db, ctx, groupId, parsed.data);
  revalidatePath("/menu");
  return { ok: true };
}

export async function setModifierOptionActiveAction(formData: FormData): Promise<void> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  await setModifierOptionActive(
    db,
    ctx,
    String(formData.get("groupId")),
    String(formData.get("optionId")),
    formData.get("active") === "true",
  );
  revalidatePath("/menu");
}

export async function setItemModifierGroupsAction(menuItemId: string, groupIds: string[]): Promise<void> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  await setItemModifierGroups(db, ctx, menuItemId, groupIds);
  revalidatePath(`/menu/${menuItemId}`);
}
