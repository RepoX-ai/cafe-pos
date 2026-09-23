"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { asActionResult } from "@/lib/permissions/action-result";
import { requirePermission } from "@/lib/permissions/permissions";
import { adjustmentInputSchema } from "@/lib/validation/adjustment";
import { flattenZodErrors } from "@/lib/validation/form-errors";
import { stockCountInputSchema } from "@/lib/validation/stock-count";
import { createManualAdjustment, InsufficientStockError } from "@/server/services/inventory-service";
import { createAndSubmitStockCount } from "@/server/services/stock-count-service";
import { getBusinessById } from "@/server/services/business-service";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";

export type InventoryActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

export async function createManualAdjustmentAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "inventory:adjust");

    const parsed = adjustmentInputSchema.safeParse({
      ingredientId: formData.get("ingredientId"),
      direction: formData.get("direction"),
      quantityBaseUnits: formData.get("quantityBaseUnits"),
      reason: formData.get("reason"),
      notes: formData.get("notes"),
      idempotencyKey: formData.get("idempotencyKey") ?? undefined,
    });
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
    }
    if (!(await allowUserAction(db, RATE_LIMITS.inventoryWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };

    const business = await getBusinessById(db, user.businessId);
    try {
      await createManualAdjustment(
        db,
        { businessId: user.businessId, userId: user.id },
        parsed.data,
        { allowNegativeStock: business?.allowNegativeStock ?? false },
      );
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    revalidatePath("/inventory");
    revalidatePath("/ingredients");
    invalidatePosMenuCache(user.businessId);
    return { ok: true };
  });
}

export async function submitStockCountAction(input: unknown): Promise<InventoryActionState> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "inventory:adjust");

    const parsed = stockCountInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid stock count." };
    }
    if (!(await allowUserAction(db, RATE_LIMITS.inventoryWrite(), user))) return { ok: false, error: "Too many changes in a short time. Wait a moment and try again." };

    await createAndSubmitStockCount(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    revalidatePath("/inventory");
    revalidatePath("/ingredients");
    invalidatePosMenuCache(user.businessId);
    return { ok: true };
  });
}
