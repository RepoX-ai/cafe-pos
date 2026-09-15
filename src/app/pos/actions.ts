"use server";

import { after } from "next/server";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { submitOrderForUser, type SubmitOrderResult } from "@/server/services/checkout";
import { recordDevicePrintResult } from "@/server/services/print-service";
import { requirePermission } from "@/lib/permissions/permissions";
import { claimRateLimitCleanupSlot, deleteExpiredRateLimitBuckets } from "@/server/services/rate-limit";

export type { SubmitOrderResult };

export async function submitOrderAction(input: unknown): Promise<SubmitOrderResult> {
  const user = await requireCurrentUser();
  const result = await submitOrderForUser(db, user, input);
  if (claimRateLimitCleanupSlot()) after(() => deleteExpiredRateLimitBuckets(db).catch(() => undefined));
  return result;
}

/**
 * The tablet reporting what its Bluetooth printer did. Only says whether
 * the bytes reached the printer — the server can't see the paper — so a
 * receipt that jams after a successful send still needs a reprint.
 */
export async function reportDevicePrintResultAction(
  printJobId: string,
  outcome: { ok: boolean; error?: string },
): Promise<{ status: string }> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "orders:create");
  try {
    const result = await recordDevicePrintResult(db, user, printJobId, outcome);
    return { status: result.status };
  } catch {
    // Never fail the cashier's flow over bookkeeping: the order is saved and
    // the receipt may well have printed.
    return { status: "UNKNOWN" };
  }
}
