import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { orders, printJobs } from "@/lib/db/schema";
import { getPrinterProvider, type PrintJobPayload } from "@/printing";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

export interface ProcessResult {
  status: "PRINTED" | "FAILED" | "QUEUED" | "PROCESSING" | "CANCELLED";
  requiresClientAction?: "window_print";
  payload?: PrintJobPayload;
  error?: string;
}

/**
 * Attempts to print a queued/failed job through its configured provider.
 * Never touches order or inventory rows — printing is deliberately
 * decoupled from the order-submission transaction (PRD's "critical
 * principle": stock is deducted at submission, not at print success).
 */
export async function processPrintJob(db: Database, printJobId: string): Promise<ProcessResult> {
  const [job] = await db.select().from(printJobs).where(eq(printJobs.id, printJobId)).limit(1);
  if (!job) throw new Error("Print job not found");

  if (job.status === "PRINTED" || job.status === "CANCELLED") return { status: job.status };
  const [claimed] = await db
    .update(printJobs)
    .set({ status: "PROCESSING", attemptCount: job.attemptCount + 1, processedAt: new Date() })
    .where(and(eq(printJobs.id, printJobId), inArray(printJobs.status, ["QUEUED", "FAILED"]))).returning();
  if (!claimed) return { status: "PROCESSING" };

  const provider = getPrinterProvider(job.provider);
  const payload = job.payloadSnapshot as PrintJobPayload;
  let result;
  try { result = await provider.print(payload); }
  catch { result = { success: false, error: "Printer request failed." }; }

  if (result.requiresClientAction === "window_print") {
    // Browser fallback: there is no server-side confirmation channel, so
    // handing off to the client is the best this provider can do. The UI
    // must still label this as a fallback, not real thermal printing.
    await db.update(printJobs).set({ status: "QUEUED", printedAt: null, lastError: "Awaiting browser print" }).where(eq(printJobs.id, printJobId));
    return { status: "QUEUED", requiresClientAction: "window_print", payload };
  }

  if (result.success) {
    await db.update(printJobs).set({ status: "PRINTED", printedAt: new Date() }).where(eq(printJobs.id, printJobId));
    return { status: "PRINTED" };
  }

  await db
    .update(printJobs)
    .set({ status: "FAILED", lastError: result.error ?? "Unknown print error" })
    .where(eq(printJobs.id, printJobId));
  return { status: "FAILED", error: result.error };
}

export async function retryPrintJob(db: Database, actor: ActorContext, printJobId: string) {
  const [job] = await db
    .select({ id: printJobs.id, orderId: printJobs.orderId })
    .from(printJobs)
    .innerJoin(orders, eq(printJobs.orderId, orders.id))
    .where(and(eq(printJobs.id, printJobId), eq(orders.businessId, actor.businessId)))
    .limit(1);
  if (!job) throw new Error("Print job not found");

  const result = await processPrintJob(db, printJobId);

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "print_job.retried",
    entityType: "print_job",
    entityId: printJobId,
    metadata: { result: result.status },
  });

  return result;
}

/**
 * Reprint: a new print job for the same order, never a new order and
 * never another inventory deduction (PRD §6.10).
 */
export async function createReprintJob(db: Database, actor: ActorContext, orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.businessId, actor.businessId)))
    .limit(1);
  if (!order) throw new Error("Order not found");

  const [lastJob] = await db
    .select()
    .from(printJobs)
    .where(eq(printJobs.orderId, orderId))
    .orderBy(desc(printJobs.createdAt))
    .limit(1);

  const [job] = await db
    .insert(printJobs)
    .values({
      orderId,
      destination: lastJob?.destination ?? "CUSTOMER_RECEIPT",
      provider: (process.env.PRINT_PROVIDER as "mock" | "browser" | "bridge") || "mock",
      status: "QUEUED",
      payloadSnapshot: lastJob?.payloadSnapshot ?? {},
      requestedBy: actor.userId,
    })
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "order.reprinted",
    entityType: "print_job",
    entityId: job.id,
    metadata: { orderId },
  });

  return processPrintJob(db, job.id);
}
