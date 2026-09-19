"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { asActionResult } from "@/lib/permissions/action-result";
import { requirePermission } from "@/lib/permissions/permissions";
import { createStaffInputSchema, updateStaffInputSchema } from "@/lib/validation/staff";
import { flattenZodErrors } from "@/lib/validation/form-errors";
import {
  countStaffAttribution,
  createStaff,
  deleteStaff,
  resetStaffPassword,
  setStaffActive,
  updateStaff,
  type StaffAttributionEntry,
} from "@/server/services/staff-service";
import { consumeRateLimit, RATE_LIMITS } from "@/server/services/rate-limit";

export type CreateStaffResult =
  | { ok: true; tempPassword: string | null; linkedExistingAccount: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const THROTTLED = { ok: false as const, error: "Too many staff changes. Wait a moment and try again." };

export async function createStaffAction(input: unknown): Promise<CreateStaffResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "staff:write");

    const parsed = createStaffInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
    }

    if (!(await consumeRateLimit(db, { rule: RATE_LIMITS.staffWrite(), key: [user.businessId, user.id] }))) {
      return THROTTLED;
    }

    try {
      const { tempPassword, linkedExistingAccount } = await createStaff(
        db,
        { businessId: user.businessId, userId: user.id },
        parsed.data,
      );
      revalidatePath("/settings/staff");
      return { ok: true, tempPassword, linkedExistingAccount };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
}

export async function setStaffActiveAction(userId: string, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "staff:write");

    if (userId === user.id && !active) {
      return { ok: false, error: "You can't deactivate your own account." };
    }

    try {
      await setStaffActive(db, { businessId: user.businessId, userId: user.id }, userId, active);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    revalidatePath("/settings/staff");
    return { ok: true };
  });
}

export async function resetStaffPasswordAction(userId: string): Promise<CreateStaffResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "staff:write");

    if (!(await consumeRateLimit(db, { rule: RATE_LIMITS.staffWrite(), key: [user.businessId, user.id] }))) {
      return THROTTLED;
    }

    try {
      const { tempPassword } = await resetStaffPassword(db, { businessId: user.businessId, userId: user.id }, userId);
      return { ok: true, tempPassword, linkedExistingAccount: false };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
}

export type UpdateStaffResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function updateStaffAction(userId: string, input: unknown): Promise<UpdateStaffResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "staff:write");

    const parsed = updateStaffInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
    }

    try {
      await updateStaff(db, { businessId: user.businessId, userId: user.id }, userId, parsed.data);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    revalidatePath("/settings/staff");
    return { ok: true };
  });
}

/**
 * Read-only lookup for the delete confirmation dialog — fetched when the
 * dialog opens rather than for every row on page load, since it is nine
 * count queries and most visits never delete anybody.
 */
export async function staffDeletionImpactAction(
  userId: string,
): Promise<{ ok: true; entries: StaffAttributionEntry[] } | { ok: false; error: string }> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "staff:write");

    try {
      const entries = await countStaffAttribution(db, { businessId: user.businessId, userId: user.id }, userId);
      return { ok: true, entries };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });
}

export async function deleteStaffAction(
  userId: string,
): Promise<{ ok: true; accountDeleted: boolean } | { ok: false; error: string }> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "staff:write");

    if (!(await consumeRateLimit(db, { rule: RATE_LIMITS.staffWrite(), key: [user.businessId, user.id] }))) {
      return THROTTLED;
    }

    let accountDeleted: boolean;
    try {
      ({ accountDeleted } = await deleteStaff(db, { businessId: user.businessId, userId: user.id }, userId));
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    revalidatePath("/settings/staff");
    return { ok: true, accountDeleted };
  });
}
