"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { purchaseInputSchema } from "@/lib/validation/purchase";
import { createSupplier, updateSupplier, setSupplierActive, type SupplierInput } from "@/server/services/supplier-service";
import { createAndFinalizePurchase } from "@/server/services/purchase-service";

export type PurchaseActionState = { ok: true } | { ok: false; error: string };

export async function createPurchaseAction(input: unknown): Promise<PurchaseActionState> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "purchases:write");

  const parsed = purchaseInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid purchase." };
  }

  await createAndFinalizePurchase(db, { businessId: user.businessId, userId: user.id }, parsed.data);
  revalidatePath("/purchases");
  revalidatePath("/ingredients");
  revalidatePath("/inventory");
  return { ok: true };
}

export async function createSupplierAction(input: SupplierInput): Promise<PurchaseActionState> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "purchases:write");
  if (!input.name?.trim()) return { ok: false, error: "Supplier name is required." };

  await createSupplier(db, { businessId: user.businessId, userId: user.id }, input);
  revalidatePath("/purchases");
  return { ok: true };
}

export async function updateSupplierAction(id: string, input: SupplierInput): Promise<PurchaseActionState> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "purchases:write");
  if (!input.name?.trim()) return { ok: false, error: "Supplier name is required." };

  await updateSupplier(db, { businessId: user.businessId, userId: user.id }, id, input);
  revalidatePath("/purchases");
  return { ok: true };
}

export async function setSupplierActiveAction(id: string, active: boolean): Promise<void> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "purchases:write");
  await setSupplierActive(db, { businessId: user.businessId, userId: user.id }, id, active);
  revalidatePath("/purchases");
}
