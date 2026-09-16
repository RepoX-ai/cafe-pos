"use server";

import { after } from "next/server";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { submitOrderForUser, type SubmitOrderResult } from "@/server/services/checkout";
import { createReprintJob, findReprintJob, PrintNotAllowedError, recordDevicePrintResult } from "@/server/services/print-service";
import { requirePermission } from "@/lib/permissions/permissions";
import { claimRateLimitCleanupSlot, consumeRateLimit, deleteExpiredRateLimitBuckets, RATE_LIMITS } from "@/server/services/rate-limit";
import type { PrintJobPayload } from "@/printing/printer-provider";

export type { SubmitOrderResult };

export type ReprintResult =
  | { ok: true; status: string; payload?: PrintJobPayload; devicePrintJobId?: string; error?: string }
  | { ok: false; error: string };

export async function submitOrderAction(input: unknown): Promise<SubmitOrderResult> {
  const user = await requireCurrentUser();
  const result = await submitOrderForUser(db, user, input);
  if (claimRateLimitCleanupSlot()) after(() => deleteExpiredRateLimitBuckets(db).catch(() => undefined));
  return result;
}

/**
 * Reprints a receipt from POS order history. Creates a new print job —
 * never a new order, and never another stock deduction (PRD §6.10).
 *
 * `requestKey` makes one tap idempotent: retrying the same key returns the
 * job that tap already created, so a flaky connection can't quietly queue
 * two receipts, while a second deliberate tap (new key) queues another.
 */
export async function reprintReceiptAction(orderId: string, requestKey: string): Promise<ReprintResult> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "orders:reprint");
  if (!/^[0-9a-f-]{16,100}$/i.test(requestKey)) return { ok: false, error: "Invalid request." };

  const isRetry = (await findReprintJob(db, user.businessId, orderId, requestKey)) !== null;
  if (!isRetry && !(await consumeRateLimit(db, { rule: RATE_LIMITS.print(), key: [user.businessId, user.id] }))) {
    return { ok: false, error: "Too many print requests. Wait a moment and try again." };
  }

  try {
    const result = await createReprintJob(db, { businessId: user.businessId, userId: user.id }, orderId, requestKey);
    return {
      ok: true,
      status: result.status,
      payload: result.payload,
      devicePrintJobId: result.requiresClientAction === "device_print" ? result.printJobId : undefined,
      error: result.error,
    };
  } catch (error) {
    if (error instanceof PrintNotAllowedError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not queue this receipt for reprinting." };
  }
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
