import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { printJobs } from "@/lib/db/schema";
import { requirePermission, type RoleName } from "@/lib/permissions/permissions";
import { submitOrderInputSchema } from "@/lib/validation/order";
import type { PrintJobPayload } from "@/printing/printer-provider";
import { InsufficientStockError } from "./inventory-service";
import { findOrderByIdempotencyKey, OrderValidationError, submitOrder } from "./order-service";
import { processPrintJob } from "./print-service";
import { consumeRateLimit, RATE_LIMITS, type RateLimitRule } from "./rate-limit";

export type SubmitOrderResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      total: number;
      idempotent: boolean;
      printStatus: string;
      receipt?: PrintJobPayload;
      /** Set when the receipt is the tablet's to print over Bluetooth. */
      devicePrintJobId?: string;
    }
  | { ok: false; error: string };

/**
 * The POS checkout entry point, in a fixed order: permission, input shape,
 * then throttling. A retry of an idempotency key that already produced an
 * order skips the throttle — it creates nothing new, and a cashier must
 * always be able to recover a submission whose response was lost.
 */
export async function submitOrderForUser(
  db: Database,
  user: { id: string; businessId: string; roles: RoleName[] },
  input: unknown,
  opts: { checkoutRule?: RateLimitRule } = {},
): Promise<SubmitOrderResult> {
  requirePermission(user.roles, "orders:create");

  const parsed = submitOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid order." };
  }

  const alreadySubmitted = await findOrderByIdempotencyKey(db, user.businessId, parsed.data.idempotencyKey);
  if (!alreadySubmitted) {
    const allowed = await consumeRateLimit(db, {
      rule: opts.checkoutRule ?? RATE_LIMITS.checkout(),
      key: [user.businessId, user.id],
    });
    if (!allowed) {
      return { ok: false, error: "Too many orders submitted in a short time. Wait a moment, then retry this order." };
    }
  }

  try {
    const { order, idempotent } = await submitOrder(db, { businessId: user.businessId, userId: user.id }, parsed.data);

    let printStatus = "QUEUED";
    let receipt: PrintJobPayload | undefined;
    let devicePrintJobId: string | undefined;
    const [job] = await db.select().from(printJobs).where(eq(printJobs.orderId, order.id)).limit(1);
    if (job) {
      printStatus = job.status;
      // Both of these providers print on the client, so the client needs the
      // snapshot. A retried submission gets it too — the tablet may have
      // lost the response before printing.
      if (job.provider === "browser" || job.provider === "device") receipt = job.payloadSnapshot as PrintJobPayload;
      if (job.provider === "device" && job.status !== "PRINTED" && job.status !== "CANCELLED") devicePrintJobId = job.id;
      if (!idempotent) {
        try {
          const result = await processPrintJob(db, job.id);
          printStatus = result.status;
        } catch {
          printStatus = "FAILED";
        }
      }
    }

    return {
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
      idempotent,
      printStatus,
      receipt,
      devicePrintJobId,
    };
  } catch (error) {
    if (error instanceof InsufficientStockError || error instanceof OrderValidationError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
