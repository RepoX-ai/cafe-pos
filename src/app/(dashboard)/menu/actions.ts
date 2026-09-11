"use server";

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
import {
  createCategory,
  createMenuItem,
  createModifierGroup,
  createModifierOption,
  createVariant,
  setCategoryActive,
  setItemModifierGroups,
  setMenuItemActive,
  setModifierGroupActive,
  setModifierOptionActive,
  setVariantActive,
  updateCategory,
  updateMenuItem,
  updateVariant,
} from "@/server/services/menu-service";

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

export async function updateCategoryAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const id = String(formData.get("id") ?? "");
  const parsed = categoryInputSchema.safeParse({
    name: formData.get("name"),
    displayOrder: formData.get("displayOrder") || 0,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  await updateCategory(db, ctx, id, parsed.data);
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
  const parsed = menuItemInputSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") || "",
    description: formData.get("description"),
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
  const parsed = menuItemInputSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId") || "",
    description: formData.get("description"),
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

// --- Variants --------------------------------------------------------------------

export async function createVariantAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
  const { user, actor: ctx } = await actor();
  requirePermission(user.roles, "menu:write");
  const menuItemId = String(formData.get("menuItemId") ?? "");
  const parsed = variantInputSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
    active: formData.get("active") === "on" || formData.get("active") === null,
    displayOrder: formData.get("displayOrder") || 0,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  await createVariant(db, ctx, menuItemId, parsed.data);
  revalidatePath(`/menu/${menuItemId}`);
  return { ok: true };
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
