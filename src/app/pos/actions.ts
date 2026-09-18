"use server";

import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { submitOrderForUser, type SubmitOrderResult } from "@/server/services/checkout";
import {
  createReprintJob,
  findReprintJob,
  PrintNotAllowedError,
  processPrintJob,
  recordDevicePrintResult,
} from "@/server/services/print-service";
import { requirePermission } from "@/lib/permissions/permissions";
import { claimRateLimitCleanupSlot, consumeRateLimit, deleteExpiredRateLimitBuckets, RATE_LIMITS } from "@/server/services/rate-limit";
import type { PrintJobPayload } from "@/printing/printer-provider";

export type { SubmitOrderResult };

export type ReprintResult =
  | { ok: true; status: string; payload?: PrintJobPayload; devicePrintJobId?: string; devicePrintToken?: string; error?: string }
  | { ok: false; error: string };

/**
 * A fresh authorization to send one receipt's bytes from this tablet. The
 * token identifies the attempt, so an outcome reported against it can never
 * complete or fail a different one.
 */
export type DevicePrintAuthorization =
  | { ok: true; printJobId: string; attemptToken: string; payload: PrintJobPayload }
  | { ok: false; status: string; error: string };

const deviceOutcomeSchema = z.object({
  printJobId: z.string().uuid(),
  attemptToken: z.string().uuid(),
  outcome: z.object({ ok: z.boolean(), error: z.string().max(500).optional() }),
});

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
    const result = await createReprintJob(db, { businessId: user.businessId, userId: user.id }, orderId, requestKey, {
      deviceCapable: true,
    });
    const authorized = result.requiresClientAction === "device_print";
    return {
      ok: true,
      status: result.status,
      payload: result.payload,
      devicePrintJobId: authorized ? result.printJobId : undefined,
      devicePrintToken: authorized ? result.attemptToken : undefined,
      error: result.error,
    };
  } catch (error) {
    if (error instanceof PrintNotAllowedError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not queue this receipt for reprinting." };
  }
}

/**
 * Re-authorizes an existing device print job after a failed or unknown
 * attempt. Deliberate: staff tapped "Print receipt" again. The bytes are
 * never resent without going through this, so a retry always runs against a
 * fresh claim instead of a token whose attempt has already been closed.
 */
export async function retryDevicePrintAction(printJobId: string): Promise<DevicePrintAuthorization> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "orders:create");
  if (!z.string().uuid().safeParse(printJobId).success) return { ok: false, status: "UNKNOWN", error: "Invalid request." };
  if (!(await consumeRateLimit(db, { rule: RATE_LIMITS.print(), key: [user.businessId, user.id] }))) {
    return { ok: false, status: "UNKNOWN", error: "Too many print requests. Wait a moment and try again." };
  }

  try {
    const result = await processPrintJob(db, user.businessId, printJobId, { deviceCapable: true });
    if (result.requiresClientAction === "device_print" && result.printJobId && result.attemptToken && result.payload) {
      return { ok: true, printJobId: result.printJobId, attemptToken: result.attemptToken, payload: result.payload };
    }
    return {
      ok: false,
      status: result.status,
      error: result.error ?? `This receipt can't be sent again — its print job is ${result.status.toLowerCase()}.`,
    };
  } catch (error) {
    if (error instanceof PrintNotAllowedError) return { ok: false, status: "CANCELLED", error: error.message };
    return { ok: false, status: "UNKNOWN", error: "Could not re-send this receipt. Check the order's detail page." };
  }
}

/**
 * The tablet reporting what its Bluetooth printer did with one attempt.
 * Only says whether the bytes reached the printer — the server can't see
 * the paper — so a receipt that jams after a successful send still needs a
 * reprint. `UNKNOWN` means the outcome was not recorded at all: the job's
 * lease expires and it surfaces for a person to check.
 */
export async function reportDevicePrintResultAction(
  printJobId: string,
  attemptToken: string,
  outcome: { ok: boolean; error?: string },
): Promise<{ status: string }> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "orders:create");
  const parsed = deviceOutcomeSchema.safeParse({ printJobId, attemptToken, outcome });
  if (!parsed.success) return { status: "UNKNOWN" };
  try {
    const result = await recordDevicePrintResult(db, user, parsed.data.printJobId, parsed.data.attemptToken, parsed.data.outcome);
    return { status: result.status };
  } catch {
    // Never fail the cashier's flow over bookkeeping: the order is saved and
    // the receipt may well have printed.
    return { status: "UNKNOWN" };
  }
}
