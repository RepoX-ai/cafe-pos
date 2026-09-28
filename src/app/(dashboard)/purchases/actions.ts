"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { assertActionScope } from "@/lib/auth/action-scope";
import { asActionResult, type ActionOutcome } from "@/lib/permissions/action-result";
import { requirePermission } from "@/lib/permissions/permissions";
import { purchaseInputSchema } from "@/lib/validation/purchase";
import { calendarDateSchema } from "@/lib/validation/bounds";
import { supplierInputSchema } from "@/lib/validation/menu";
import { z } from "zod";
import { createSupplier, updateSupplier, setSupplierActive, type SupplierInput } from "@/server/services/supplier-service";
import { createAndFinalizePurchase, setPurchasePaidAt } from "@/server/services/purchase-service";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";

export type PurchaseActionState = { ok: true } | { ok: false; error: string };

export async function createPurchaseAction(expectedScope: unknown, input: unknown): Promise<PurchaseActionState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "purchases:write");
    assertActionScope(user, expectedScope);

    const parsed = purchaseInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid purchase." };
    }
    if (!(await allowUserAction(db, RATE_LIMITS.inventoryWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };

    await createAndFinalizePurchase(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    revalidatePath("/purchases");
    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    revalidatePath("/ingredients");
    revalidatePath("/inventory");
    invalidatePosMenuCache(user.businessId);
    return { ok: true };
  });
}

const supplierIdSchema = z.string().uuid();

export async function createSupplierAction(expectedScope: unknown, input: SupplierInput): Promise<PurchaseActionState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "purchases:write");
    assertActionScope(user, expectedScope);
    const parsed = supplierInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the supplier details." };
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };

    await createSupplier(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    revalidatePath("/purchases");
    return { ok: true };
  });
}

export async function updateSupplierAction(expectedScope: unknown, id: string, input: SupplierInput): Promise<PurchaseActionState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "purchases:write");
    assertActionScope(user, expectedScope);
    const parsed = supplierInputSchema.safeParse(input);
    if (!parsed.success || !supplierIdSchema.safeParse(id).success) {
      return { ok: false, error: parsed.error?.issues[0]?.message ?? "Check the supplier details." };
    }
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };

    await updateSupplier(db, { businessId: user.businessId, userId: user.id }, id, parsed.data);
    revalidatePath("/purchases");
    return { ok: true };
  });
}

export async function setSupplierActiveAction(expectedScope: unknown, id: string, active: boolean): Promise<ActionOutcome> {
  return asActionResult(async (): Promise<ActionOutcome> => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "purchases:write");
    assertActionScope(user, expectedScope);
    if (!supplierIdSchema.safeParse(id).success || typeof active !== "boolean") return { ok: false, error: "Invalid request." };
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };
    await setSupplierActive(db, { businessId: user.businessId, userId: user.id }, id, active);
    revalidatePath("/purchases");
  });
}

/** Payment confirmation is separate from stock receipt finalization. */
export async function updatePurchasePaymentAction(expectedScope: unknown, id: string, paidAt: string | null): Promise<PurchaseActionState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "purchases:write");
    assertActionScope(user, expectedScope);
    if (!supplierIdSchema.safeParse(id).success || (paidAt !== null && !calendarDateSchema.safeParse(paidAt).success)) {
      return { ok: false, error: "Choose a valid payment date." };
    }
    if (!(await allowUserAction(db, RATE_LIMITS.catalogWrite(), user))) {
      return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };
    }
    await setPurchasePaidAt(db, { businessId: user.businessId, userId: user.id }, id, paidAt);
    revalidatePath(`/purchases/${id}`);
    revalidatePath("/purchases");
    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    return { ok: true };
  });
}
