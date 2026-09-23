import { asc, eq } from "drizzle-orm";
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
      /** Null on non-cash orders; set whenever a cash tender was recorded. */
      cashReceived: number | null;
      changeDue: number | null;
      idempotent: boolean;
      printStatus: string;
      receipt?: PrintJobPayload;
      /** Set when the receipt is the tablet's to print over Bluetooth. */
      devicePrintJobId?: string;
      /** The attempt this response authorizes; sent back with the outcome. */
      devicePrintToken?: string;
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
  opts: { checkoutRule?: RateLimitRule; retryRule?: RateLimitRule } = {},
): Promise<SubmitOrderResult> {
  requirePermission(user.roles, "orders:create");

  const parsed = submitOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid order." };
  }

  // One lookup serves both the throttle exemption and submitOrder's own
  // idempotency check.
  const alreadySubmitted = await findOrderByIdempotencyKey(db, user.businessId, parsed.data.idempotencyKey);
  // Retries are never refused — a cashier must always be able to recover a
  // submission whose response was lost — but they are bounded: past the
  // retry quota the order is still returned, and only the print-job claim
  // (the part with real work and locks) is skipped.
  let processPrint = true;
  if (alreadySubmitted) {
    processPrint = await consumeRateLimit(db, { rule: opts.retryRule ?? RATE_LIMITS.checkoutRetry(), key: [user.businessId, user.id] });
  } else {
    const allowed = await consumeRateLimit(db, {
      rule: opts.checkoutRule ?? RATE_LIMITS.checkout(),
      key: [user.businessId, user.id],
    });
    if (!allowed) {
      return { ok: false, error: "Too many orders submitted in a short time. Wait a moment, then retry this order." };
    }
  }

  try {
    const { order, idempotent } = await submitOrder(db, { businessId: user.businessId, userId: user.id }, parsed.data, {
      idempotencyKeyChecked: !alreadySubmitted,
    });

    let printStatus = "QUEUED";
    let receipt: PrintJobPayload | undefined;
    let devicePrintJobId: string | undefined;
    let devicePrintToken: string | undefined;
    // The job checkout itself queued is the oldest one; a retried submission
    // must not pick up a later reprint instead.
    const [job] = await db.select().from(printJobs).where(eq(printJobs.orderId, order.id)).orderBy(asc(printJobs.createdAt)).limit(1);
    if (job && !processPrint) {
      printStatus = job.status;
    } else if (job) {
      printStatus = job.status;
      // Both the fresh and the retried submission go through the same claim:
      // a retry whose response was lost may genuinely still need the receipt,
      // but it must not be handed a second live authorization for a receipt
      // another request is already printing. processPrintJob refuses that
      // and reports the job's real status instead.
      try {
        const result = await processPrintJob(db, order.businessId, job.id, { deviceCapable: true });
        printStatus = result.status;
        // Both client-side providers need the snapshot to print from — and
        // only get it as part of an authorization they actually hold.
        if (result.requiresClientAction) receipt = result.payload;
        if (result.requiresClientAction === "device_print") {
          devicePrintJobId = result.printJobId;
          devicePrintToken = result.attemptToken;
        }
      } catch {
        printStatus = "FAILED";
      }
    }

    return {
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
      cashReceived: order.cashReceived,
      changeDue: order.changeDue,
      idempotent,
      printStatus,
      receipt,
      devicePrintJobId,
      devicePrintToken,
    };
  } catch (error) {
    if (error instanceof InsufficientStockError || error instanceof OrderValidationError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
