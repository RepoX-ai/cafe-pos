"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { printJobs } from "@/lib/db/schema";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { submitOrderInputSchema } from "@/lib/validation/order";
import { OrderValidationError, submitOrder } from "@/server/services/order-service";
import { InsufficientStockError } from "@/server/services/inventory-service";
import { processPrintJob } from "@/server/services/print-service";

export type SubmitOrderResult =
  | { ok: true; orderId: string; orderNumber: string; total: number; idempotent: boolean; printStatus: string }
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

    let printStatus = "QUEUED";
    // Only attempt printing for a genuinely new submission — an
    // idempotent replay (double tap, retry) must not trigger another
    // print attempt for a job that may already be printing/printed.
    if (!idempotent) {
      const [job] = await db.select().from(printJobs).where(eq(printJobs.orderId, order.id)).limit(1);
      if (job) {
        try {
          const result = await processPrintJob(db, job.id);
          printStatus = result.status;
        } catch {
          printStatus = "FAILED";
        }
      }
    }

    return { ok: true, orderId: order.id, orderNumber: order.orderNumber, total: order.total, idempotent, printStatus };
  } catch (error) {
    if (error instanceof InsufficientStockError || error instanceof OrderValidationError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
