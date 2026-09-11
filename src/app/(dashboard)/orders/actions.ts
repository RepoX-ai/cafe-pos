"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { cancelOrderInputSchema } from "@/lib/validation/order";
import { cancelOrder, OrderValidationError, refundOrder } from "@/server/services/order-service";

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
