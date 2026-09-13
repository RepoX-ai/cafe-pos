"use server";

import type { PrintJobPayload } from "@/printing/printer-provider";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { cancelOrderInputSchema } from "@/lib/validation/order";
import { cancelOrder, OrderValidationError, refundOrder } from "@/server/services/order-service";
import { createReprintJob, retryPrintJob } from "@/server/services/print-service";

export type CancelOrderResult = { ok: true } | { ok: false; error: string };

export async function cancelOrderAction(input: unknown): Promise<CancelOrderResult> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "orders:cancel");

  const parsed = cancelOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
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
  return { ok: true };
}

export type PrintActionResult = { ok: true; status: string; payload?: PrintJobPayload } | { ok: false; error: string };

export async function retryPrintJobAction(printJobId: string, orderId: string): Promise<PrintActionResult> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "printer:manage");

  const result = await retryPrintJob(db, { businessId: user.businessId, userId: user.id }, printJobId);
  revalidatePath(`/orders/${orderId}`);
  return { ok: true, status: result.status, payload: result.payload };
}

export async function reprintOrderAction(orderId: string): Promise<PrintActionResult> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "orders:reprint");

  const result = await createReprintJob(db, { businessId: user.businessId, userId: user.id }, orderId);
  revalidatePath(`/orders/${orderId}`);
  return { ok: true, status: result.status, payload: result.payload };
}

export async function refundOrderAction(input: unknown): Promise<CancelOrderResult> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "orders:refund");

  const parsed = cancelOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
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
  return { ok: true };
}
