import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { orders, printJobs } from "@/lib/db/schema";
import { getPrinterProvider, type PrintJobPayload } from "@/printing";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

function positiveIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Attempts one job may make before only a deliberate Reprint can send that receipt again. */
export const PRINT_JOB_MAX_ATTEMPTS = positiveIntEnv("PRINT_JOB_MAX_ATTEMPTS", 5);
/** How long a claim stays valid. Keep it above the slowest expected provider call. */
export const PRINT_JOB_LEASE_SECONDS = positiveIntEnv("PRINT_JOB_LEASE_SECONDS", 120);

export const UNCERTAIN_PRINT_ERROR =
  "Print outcome unknown: processing stopped before the result was recorded. Check whether this receipt printed before retrying.";

export interface ProcessResult {
  status: "PRINTED" | "FAILED" | "QUEUED" | "PROCESSING" | "CANCELLED";
  requiresClientAction?: "window_print";
  payload?: PrintJobPayload;
  error?: string;
}

/**
 * A PROCESSING claim whose lease has run out — its worker crashed or timed
 * out. Rows claimed before leases existed have no lease; they count once
 * they've been processing longer than one lease.
 */
export function abandonedPrintClaim() {
  return and(
    eq(printJobs.status, "PROCESSING"),
    or(
      lt(printJobs.leaseExpiresAt, sql`now()`),
      and(
        isNull(printJobs.leaseExpiresAt),
        or(isNull(printJobs.processedAt), lt(printJobs.processedAt, sql`now() - make_interval(secs => ${PRINT_JOB_LEASE_SECONDS}::double precision)`)),
      ),
    ),
  );
}

/**
 * Attempts to print a queued/failed job through its configured provider.
 * Never touches order or inventory rows — printing is deliberately
 * decoupled from the order-submission transaction (PRD's "critical
 * principle": stock is deducted at submission, not at print success).
 *
 * Delivery guarantee: at most one worker holds a job at a time (claim +
 * lease), and a worker can only record the outcome of its own claim. That
 * is not exactly-once paper output: a worker can send bytes to the printer
 * and die before recording success. Such a job is never retried
 * automatically — recovery marks it FAILED with an "outcome unknown" error,
 * and a person decides whether to retry.
 */
export async function processPrintJob(db: Database, printJobId: string): Promise<ProcessResult> {
  const [job] = await db.select().from(printJobs).where(eq(printJobs.id, printJobId)).limit(1);
  if (!job) throw new Error("Print job not found");
  if (job.status === "PRINTED" || job.status === "CANCELLED") return { status: job.status };

  const claimToken = randomUUID();
  const [claimed] = await db
    .update(printJobs)
    .set({
      status: "PROCESSING",
      attemptCount: sql`${printJobs.attemptCount} + 1`,
      processedAt: new Date(),
      claimToken,
      leaseExpiresAt: sql`now() + make_interval(secs => ${PRINT_JOB_LEASE_SECONDS}::double precision)`,
    })
    .where(
      and(
        eq(printJobs.id, printJobId),
        inArray(printJobs.status, ["QUEUED", "FAILED"]),
        lt(printJobs.attemptCount, PRINT_JOB_MAX_ATTEMPTS),
      ),
    )
    .returning();

  if (!claimed) {
    const [current] = await db.select().from(printJobs).where(eq(printJobs.id, printJobId)).limit(1);
    if (current && (current.status === "QUEUED" || current.status === "FAILED") && current.attemptCount >= PRINT_JOB_MAX_ATTEMPTS) {
      return { status: current.status, error: "This print job reached its retry limit. Use Reprint to send the receipt again." };
    }
    return { status: current?.status ?? "PROCESSING" };
  }

  const provider = getPrinterProvider(claimed.provider);
  const payload = claimed.payloadSnapshot as PrintJobPayload;
  let result;
  try {
    result = await provider.print(payload);
  } catch {
    result = { success: false, error: "Printer request failed." };
  }

  // Only the holder of this claim may record its outcome; if recovery or a
  // newer attempt has taken the job since, this worker's result is dropped.
  async function recordOutcome(values: Partial<typeof printJobs.$inferInsert>) {
    const updated = await db
      .update(printJobs)
      .set({ ...values, claimToken: null, leaseExpiresAt: null })
      .where(and(eq(printJobs.id, printJobId), eq(printJobs.claimToken, claimToken), eq(printJobs.status, "PROCESSING")))
      .returning({ id: printJobs.id });
    return updated.length > 0;
  }

  if (result.requiresClientAction === "window_print") {
    // Browser fallback: there is no server-side confirmation channel, so
    // handing off to the client is the best this provider can do. The UI
    // must still label this as a fallback, not real thermal printing.
    await recordOutcome({ status: "QUEUED", printedAt: null, lastError: "Awaiting browser print" });
    return { status: "QUEUED", requiresClientAction: "window_print", payload };
  }

  if (result.success) {
    if (await recordOutcome({ status: "PRINTED", printedAt: new Date(), lastError: null })) return { status: "PRINTED" };
    return { status: "PROCESSING", error: "This attempt was superseded before its result was recorded." };
  }

  const error = result.error ?? "Unknown print error";
  if (await recordOutcome({ status: "FAILED", lastError: error })) return { status: "FAILED", error };
  return { status: "PROCESSING", error: "This attempt was superseded before its result was recorded." };
}

/**
 * Marks abandoned claims FAILED with an "outcome unknown" error so they show
 * up for a person to check and retry — never reprinted automatically.
 * Scoped to one business, and optionally to one job.
 */
export async function recoverAbandonedPrintJobs(db: Database, businessId: string, printJobId?: string) {
  const recovered = await db
    .update(printJobs)
    .set({ status: "FAILED", lastError: UNCERTAIN_PRINT_ERROR, claimToken: null, leaseExpiresAt: null })
    .where(
      and(
        abandonedPrintClaim(),
        inArray(printJobs.orderId, db.select({ id: orders.id }).from(orders).where(eq(orders.businessId, businessId))),
        printJobId ? eq(printJobs.id, printJobId) : undefined,
      ),
    )
    .returning({ id: printJobs.id });
  return recovered.length;
}

export async function retryPrintJob(db: Database, actor: ActorContext, printJobId: string) {
  const [job] = await db
    .select({ id: printJobs.id, orderId: printJobs.orderId })
    .from(printJobs)
    .innerJoin(orders, eq(printJobs.orderId, orders.id))
    .where(and(eq(printJobs.id, printJobId), eq(orders.businessId, actor.businessId)))
    .limit(1);
  if (!job) throw new Error("Print job not found");

  await recoverAbandonedPrintJobs(db, actor.businessId, printJobId);
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

export async function findReprintJob(db: Database, businessId: string, orderId: string, requestKey: string) {
  const [job] = await db
    .select({ id: printJobs.id, status: printJobs.status })
    .from(printJobs)
    .innerJoin(orders, eq(printJobs.orderId, orders.id))
    .where(and(eq(printJobs.orderId, orderId), eq(printJobs.requestKey, requestKey), eq(orders.businessId, businessId)))
    .limit(1);
  return job ?? null;
}

/** A retried reprint request reports on the job its first attempt created. */
async function resultForExistingJob(db: Database, jobId: string): Promise<ProcessResult> {
  const [job] = await db.select().from(printJobs).where(eq(printJobs.id, jobId)).limit(1);
  if (!job) throw new Error("Print job not found");
  // Never processed (e.g. the request died right after creating it), or a
  // browser receipt still waiting on the client: processing is claim-guarded.
  if (job.status === "QUEUED") return processPrintJob(db, jobId);
  return { status: job.status, error: job.lastError ?? undefined };
}

/**
 * Reprint: a new print job for the same order, never a new order and
 * never another inventory deduction (PRD §6.10). `requestKey` identifies
 * one deliberate reprint: retrying that request returns the job it already
 * created, while a new click (new key) queues a new receipt.
 */
export async function createReprintJob(db: Database, actor: ActorContext, orderId: string, requestKey?: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.businessId, actor.businessId)))
    .limit(1);
  if (!order) throw new Error("Order not found");

  if (requestKey) {
    const existing = await findReprintJob(db, actor.businessId, orderId, requestKey);
    if (existing) return resultForExistingJob(db, existing.id);
  }

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
      requestKey: requestKey ?? null,
    })
    .onConflictDoNothing({ target: [printJobs.orderId, printJobs.requestKey] })
    .returning();

  if (!job) {
    // A concurrent retry of the same request created it first.
    const existing = await findReprintJob(db, actor.businessId, orderId, requestKey!);
    return resultForExistingJob(db, existing!.id);
  }

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
