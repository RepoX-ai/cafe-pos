"use server";

import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { submitOrderInputSchema } from "@/lib/validation/order";
import { OrderValidationError, submitOrder } from "@/server/services/order-service";
import { InsufficientStockError } from "@/server/services/inventory-service";

export type SubmitOrderResult =
  | { ok: true; orderId: string; orderNumber: string; total: number; idempotent: boolean }
  | { ok: false; error: string };

export async function submitOrderAction(input: unknown): Promise<SubmitOrderResult> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "orders:create");

  const parsed = submitOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid order." };
  }

  try {
    const { order, idempotent } = await submitOrder(db, { businessId: user.businessId, userId: user.id }, parsed.data);
    return { ok: true, orderId: order.id, orderNumber: order.orderNumber, total: order.total, idempotent };
  } catch (error) {
    if (error instanceof InsufficientStockError || error instanceof OrderValidationError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
