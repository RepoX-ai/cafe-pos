"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { asActionResult } from "@/lib/permissions/action-result";
import { requirePermission } from "@/lib/permissions/permissions";
import { wasteInputSchema } from "@/lib/validation/waste";
import { flattenZodErrors } from "@/lib/validation/form-errors";
import { createWasteRecord } from "@/server/services/waste-service";
import { InsufficientStockError } from "@/server/services/inventory-service";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";

export type WasteActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

export async function createWasteRecordAction(
  _prev: WasteActionState,
  formData: FormData,
): Promise<WasteActionState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "inventory:waste");

    const parsed = wasteInputSchema.safeParse({
      ingredientId: formData.get("ingredientId"),
      quantityBaseUnits: formData.get("quantityBaseUnits"),
      reason: formData.get("reason"),
      notes: formData.get("notes"),
      idempotencyKey: formData.get("idempotencyKey") ?? undefined,
    });
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
    }
    if (!(await allowUserAction(db, RATE_LIMITS.inventoryWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };

    try {
      await createWasteRecord(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    revalidatePath("/waste");
    revalidatePath("/ingredients");
    revalidatePath("/inventory");
    invalidatePosMenuCache(user.businessId);
    return { ok: true };
  });
}
