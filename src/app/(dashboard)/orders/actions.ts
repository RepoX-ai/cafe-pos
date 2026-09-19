"use server";

import type { PrintJobPayload } from "@/printing/printer-provider";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { asActionResult } from "@/lib/permissions/action-result";
import { requirePermission } from "@/lib/permissions/permissions";
import { cancelOrderInputSchema } from "@/lib/validation/order";
import { cancelOrder, OrderValidationError, refundOrder } from "@/server/services/order-service";
import { createReprintJob, findReprintJob, PrintNotAllowedError, retryPrintJob } from "@/server/services/print-service";
import { consumeRateLimit, RATE_LIMITS } from "@/server/services/rate-limit";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";

export type CancelOrderResult = { ok: true } | { ok: false; error: string };

const THROTTLED_MUTATION: CancelOrderResult = {
  ok: false,
  error: "Too many requests. Wait a moment and try again.",
};

export async function cancelOrderAction(input: unknown): Promise<CancelOrderResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "orders:cancel");

    const parsed = cancelOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
    }

    if (!(await consumeRateLimit(db, { rule: RATE_LIMITS.orderMutation(), key: [user.businessId, user.id] }))) {
      return THROTTLED_MUTATION;
    }

    try {
      await cancelOrder(db, { businessId: user.businessId, userId: user.id }, parsed.data.orderId, parsed.data.reason);
    } catch (error) {
      if (error instanceof OrderValidationError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    revalidatePath("/orders");
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath("/ingredients");
    revalidatePath("/inventory");
    invalidatePosMenuCache(user.businessId);
    return { ok: true };
  });
}

export type PrintActionResult = { ok: true; status: string; payload?: PrintJobPayload; error?: string } | { ok: false; error: string };

const printRequestSchema = z.object({
  orderId: z.string().uuid(),
  printJobId: z.string().uuid().optional(),
  requestKey: z.string().min(1).max(100).optional(),
});

const THROTTLED: PrintActionResult = { ok: false, error: "Too many print requests. Wait a moment and try again." };

export async function retryPrintJobAction(printJobId: string, orderId: string): Promise<PrintActionResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "printer:manage");

    const parsed = printRequestSchema.safeParse({ printJobId, orderId });
    if (!parsed.success || !parsed.data.printJobId) return { ok: false, error: "Invalid request." };
    if (!(await consumeRateLimit(db, { rule: RATE_LIMITS.print(), key: [user.businessId, user.id] }))) return THROTTLED;

    try {
      const result = await retryPrintJob(db, { businessId: user.businessId, userId: user.id }, parsed.data.printJobId);
      revalidatePath(`/orders/${orderId}`);
      return { ok: true, status: result.status, payload: result.payload, error: result.error };
    } catch (error) {
      if (error instanceof PrintNotAllowedError) return { ok: false, error: error.message };
      throw error;
    }
  });
}

/**
 * `requestKey` is generated once per Reprint click. Retrying that same
 * request returns the job it created (and isn't throttled); a new click
 * sends a new key and a new receipt.
 */
export async function reprintOrderAction(orderId: string, requestKey?: string): Promise<PrintActionResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "orders:reprint");

    const parsed = printRequestSchema.safeParse({ orderId, requestKey });
    if (!parsed.success) return { ok: false, error: "Invalid request." };

    const isRetry = parsed.data.requestKey
      ? (await findReprintJob(db, user.businessId, parsed.data.orderId, parsed.data.requestKey)) !== null
      : false;
    if (!isRetry && !(await consumeRateLimit(db, { rule: RATE_LIMITS.print(), key: [user.businessId, user.id] }))) {
      return THROTTLED;
    }

    try {
      const result = await createReprintJob(db, { businessId: user.businessId, userId: user.id }, parsed.data.orderId, parsed.data.requestKey);
      revalidatePath(`/orders/${orderId}`);
      return { ok: true, status: result.status, payload: result.payload, error: result.error };
    } catch (error) {
      if (error instanceof PrintNotAllowedError) return { ok: false, error: error.message };
      throw error;
    }
  });
}

export async function refundOrderAction(input: unknown): Promise<CancelOrderResult> {
  return asActionResult(async () => {
    const user = await requireCurrentUser();
    requirePermission(user.roles, "orders:refund");

    const parsed = cancelOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
    }

    if (!(await consumeRateLimit(db, { rule: RATE_LIMITS.orderMutation(), key: [user.businessId, user.id] }))) {
      return THROTTLED_MUTATION;
    }

    try {
      await refundOrder(db, { businessId: user.businessId, userId: user.id }, parsed.data.orderId, parsed.data.reason);
    } catch (error) {
      if (error instanceof OrderValidationError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    revalidatePath("/orders");
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath("/ingredients");
    revalidatePath("/inventory");
    invalidatePosMenuCache(user.businessId);
    return { ok: true };
  });
}
