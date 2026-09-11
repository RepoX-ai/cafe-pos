"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import type { RoleName } from "@/lib/permissions/permissions";
import { createStaffInputSchema } from "@/lib/validation/staff";
import { changeStaffRole, createStaff, setStaffActive } from "@/server/services/staff-service";

export type CreateStaffResult =
  | { ok: true; tempPassword: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function createStaffAction(input: unknown): Promise<CreateStaffResult> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "staff:write");

  const parsed = createStaffInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }

  try {
    const { tempPassword } = await createStaff(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    revalidatePath("/settings/staff");
    return { ok: true, tempPassword };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function setStaffActiveAction(userId: string, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
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
}

export async function changeStaffRoleAction(userId: string, role: RoleName): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "staff:write");

  try {
    await changeStaffRole(db, { businessId: user.businessId, userId: user.id }, userId, role);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  revalidatePath("/settings/staff");
  return { ok: true };
}
