import { randomUUID } from "node:crypto";
import { ServiceError } from "./errors";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { businesses, orders, printJobs } from "@/lib/db/schema";
import { configuredPrintProvider, getPrinterProvider, type PrintJobPayload } from "@/printing";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

function positiveIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Attempts one job may make before only a deliberate Reprint can send that receipt again. */
export const PRINT_JOB_MAX_ATTEMPTS = positiveIntEnv("PRINT_JOB_MAX_ATTEMPTS", 5);
/** How long a claim stays valid. Keep it above the slowest expected provider call. */
const PRINT_JOB_LEASE_SECONDS = positiveIntEnv("PRINT_JOB_LEASE_SECONDS", 120);
/**
 * A `device` attempt's lease has to cover everything the tablet does with
 * the payload, not just a server round trip: waking the Bluetooth printer
 * and reconnecting to it, the staff tap on "Connect printer and print" when
 * it isn't paired yet, and the BLE write. Three minutes sits comfortably
 * above that while still surfacing an abandoned attempt within one service
 * round, so nobody waits long to learn a receipt needs checking. There is
 * deliberately no heartbeat: the tablet already reports the outcome as soon
 * as the write resolves, so a second channel would only add failure modes.
 */
const PRINT_JOB_DEVICE_LEASE_SECONDS = positiveIntEnv("PRINT_JOB_DEVICE_LEASE_SECONDS", 180);

function leaseSecondsFor(provider: string) {
  return provider === "device" ? PRINT_JOB_DEVICE_LEASE_SECONDS : PRINT_JOB_LEASE_SECONDS;
}

/** Refusals a caller should show to the user rather than log as a fault. */
export class PrintNotAllowedError extends ServiceError {}

const CANCELLED_ORDER_PRINT_ERROR = "This order was cancelled — its receipt can no longer be printed.";

/** Refusal for a caller that has no Bluetooth printer to send the bytes with. */
export const DEVICE_PRINT_ELSEWHERE_ERROR =
  "This receipt prints from the POS tablet's Bluetooth printer. Open the order in POS order history and reprint it there.";

const IN_FLIGHT_PRINT_ERROR = "Another print attempt for this receipt is still in progress.";
const SUPERSEDED_PRINT_ERROR = "This attempt was superseded before its result was recorded.";
const RETRY_LIMIT_PRINT_ERROR = "This print job reached its retry limit. Use Reprint to send the receipt again.";

export const UNCERTAIN_PRINT_ERROR =
  "Print outcome unknown: processing stopped before the result was recorded. Check whether this receipt printed before retrying.";

/** Longest error text a client may store on a job; the column is unbounded, the UI is not. */
const MAX_PRINT_ERROR_LENGTH = 500;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProcessResult {
  status: "PRINTED" | "FAILED" | "QUEUED" | "PROCESSING" | "CANCELLED";
  requiresClientAction?: "window_print" | "device_print";
  payload?: PrintJobPayload;
  printJobId?: string;
  /**
   * Identifies the one print attempt this authorization belongs to. The
   * tablet sends it back with the outcome so a stale attempt can never
   * complete or fail a newer one. Never log it or put it in audit
   * metadata — holding it is what authorizes a receipt to be sent.
   */
  attemptToken?: string;
  error?: string;
}

export interface PrintAttemptOptions {
  /**
   * True only for callers that can actually drive the tablet's Bluetooth
   * printer (the POS screens). Anything else must not take a `device`
   * claim it can never fulfil — the lease would expire into an "outcome
   * unknown" job for staff to chase for no reason.
   */
  deviceCapable?: boolean;
}

/**
 * A PROCESSING claim whose lease has run out — its worker crashed, the
 * tablet was closed, or the outcome report never arrived. Rows claimed
 * before leases existed have no lease; they count once they've been
 * processing longer than one lease.
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

// ---------------------------------------------------------------------------
// Attempt authorization
// ---------------------------------------------------------------------------
//
// Lock order, repo-wide: orders -> ingredients -> print_jobs. Cancellation
// and refund (order-service.reverseOrder) take the order row FOR UPDATE
// first and only then touch ingredients and print jobs; every path that
// authorizes a print attempt takes the same order row first. A cancellation
// racing a reprint therefore either wins — and the reprint is refused — or
// loses, and is refused itself. Order submission inserts a brand-new order
// row nobody else can be holding, so it doesn't participate in that cycle.
//
// No transaction here ever stays open across a printer, Bluetooth or
// network call: the transaction ends the moment the claim is recorded, and
// the provider runs afterwards.

type ClaimedAttempt = { kind: "claimed"; job: typeof printJobs.$inferSelect; claimToken: string };
type RefusedAttempt = { kind: "refused"; result: ProcessResult };
type AttemptAuthorization = ClaimedAttempt | RefusedAttempt;

/**
 * Locks the tenant's order row and refuses printing for a cancelled sale.
 * Every caller that then creates or claims a print job holds this lock, so
 * the status it read cannot change under it.
 */
async function lockOrderForPrinting(tx: Database, businessId: string, orderId: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.businessId, businessId)))
    .for("update");
  if (!order) throw new Error("Order not found");
  // A cancelled sale has no receipt to hand anyone. Refunds still do: the
  // customer had the original, and staff may need a copy for the refund
  // paperwork, so only cancellation closes printing off.
  if (order.status === "CANCELLED") throw new PrintNotAllowedError(CANCELLED_ORDER_PRINT_ERROR);
  return order;
}

/**
 * Takes the exclusive attempt claim on one job. Must be called with the
 * job's order row already locked. The conditional UPDATE is what makes the
 * claim exclusive — only one concurrent caller can move a job out of
 * QUEUED/FAILED — so a pre-read is only ever used to explain a refusal.
 */
async function claimAttemptLocked(tx: Database, printJobId: string, deviceCapable: boolean): Promise<AttemptAuthorization> {
  const [job] = await tx.select().from(printJobs).where(eq(printJobs.id, printJobId)).limit(1);
  if (!job) throw new Error("Print job not found");
  if (job.status === "PRINTED" || job.status === "CANCELLED") return { kind: "refused", result: { status: job.status } };
  // Refuse before claiming rather than after: a claim this caller can't
  // fulfil would burn an attempt and then rot into "outcome unknown".
  if (job.provider === "device" && !deviceCapable) {
    return { kind: "refused", result: { status: job.status, error: DEVICE_PRINT_ELSEWHERE_ERROR } };
  }

  const claimToken = randomUUID();
  const [claimed] = await tx
    .update(printJobs)
    .set({
      status: "PROCESSING",
      attemptCount: sql`${printJobs.attemptCount} + 1`,
      processedAt: new Date(),
      claimToken,
      leaseExpiresAt: sql`now() + make_interval(secs => ${leaseSecondsFor(job.provider)}::double precision)`,
    })
    .where(
      and(
        eq(printJobs.id, printJobId),
        inArray(printJobs.status, ["QUEUED", "FAILED"]),
        lt(printJobs.attemptCount, PRINT_JOB_MAX_ATTEMPTS),
      ),
    )
    .returning();

  if (claimed) return { kind: "claimed", job: claimed, claimToken };

  const [current] = await tx.select().from(printJobs).where(eq(printJobs.id, printJobId)).limit(1);
  if (current && (current.status === "QUEUED" || current.status === "FAILED") && current.attemptCount >= PRINT_JOB_MAX_ATTEMPTS) {
    return { kind: "refused", result: { status: current.status, error: RETRY_LIMIT_PRINT_ERROR } };
  }
  if (current?.status === "PROCESSING") return { kind: "refused", result: { status: "PROCESSING", error: IN_FLIGHT_PRINT_ERROR } };
  return { kind: "refused", result: { status: current?.status ?? "PROCESSING" } };
}

/** Locks the order, then claims one attempt on an existing job. */
async function authorizeAttempt(
  db: Database,
  businessId: string,
  orderId: string,
  printJobId: string,
  deviceCapable: boolean,
): Promise<AttemptAuthorization> {
  return db.transaction(async (tx) => {
    await lockOrderForPrinting(tx, businessId, orderId);
    return claimAttemptLocked(tx, printJobId, deviceCapable);
  });
}

/**
 * Runs the provider for an attempt this process already holds the claim
 * for, and records the outcome against that claim. Runs outside any
 * transaction — a printer, a Bluetooth link and an HTTP bridge are all far
 * too slow to hold database locks across.
 */
/**
 * Attaches the business's *current* receipt logo to a payload as it is
 * handed to a printer. The logo is deliberately not part of the stored
 * snapshot: a dithered raster is ~10KB that barely compresses, and storing
 * it per job made every print job 17x larger for a cosmetic that changes
 * once a year. Prices and lines stay snapshotted (PRD rule 8); the logo is
 * read live, so a reprint shows whatever the café's logo is today.
 */
async function withCurrentLogo(db: Database, businessId: string, payload: PrintJobPayload): Promise<PrintJobPayload> {
  const [business] = await db
    .select({
      base64: businesses.logoRasterBase64,
      width: businesses.logoRasterWidth,
      height: businesses.logoRasterHeight,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  // Strip anything a job stored before this change, then add what is
  // current — so a removed logo really stops printing.
  const { logoRaster: _stored, ...rest } = payload;
  void _stored;
  if (business?.base64 && business.width && business.height) {
    return { ...rest, logoRaster: { base64: business.base64, width: business.width, height: business.height } };
  }
  return rest;
}

async function runClaimedAttempt(db: Database, { job, claimToken }: ClaimedAttempt): Promise<ProcessResult> {
  const provider = getPrinterProvider(job.provider);
  const payload = await withCurrentLogo(db, job.businessId, job.payloadSnapshot as PrintJobPayload);

  // Only the holder of this claim may record its outcome; if recovery or a
  // newer attempt has taken the job since, this worker's result is dropped.
  async function recordOutcome(values: Partial<typeof printJobs.$inferInsert>) {
    const updated = await db
      .update(printJobs)
      .set({ ...values, claimToken: null, leaseExpiresAt: null })
      .where(and(eq(printJobs.id, job.id), eq(printJobs.claimToken, claimToken), eq(printJobs.status, "PROCESSING")))
      .returning({ id: printJobs.id });
    return updated.length > 0;
  }

  let result;
  try {
    result = await provider.print(payload);
  } catch {
    result = { success: false, error: "Printer request failed." } as const;
  }

  if (result.requiresClientAction === "device_print") {
    // The printer is paired with the tablet, not the server. The claim
    // stays held for the whole handoff: the tablet is now responsible for
    // this attempt and reports back with the same token. Releasing it here
    // would let a second request hand the same pending receipt out.
    return { status: "PROCESSING", requiresClientAction: "device_print", payload, printJobId: job.id, attemptToken: claimToken };
  }

  if (result.requiresClientAction === "window_print") {
    // Browser fallback: there is no server-side confirmation channel, so
    // handing off to the client is the best this provider can do. Opening a
    // print dialog is not evidence that paper came out, so the job is put
    // back to QUEUED rather than marked PRINTED, and the UI labels it a
    // fallback.
    await recordOutcome({ status: "QUEUED", printedAt: null, lastError: "Awaiting browser print" });
    return { status: "QUEUED", requiresClientAction: "window_print", payload };
  }

  if (result.success) {
    if (await recordOutcome({ status: "PRINTED", printedAt: new Date(), lastError: null })) return { status: "PRINTED" };
    return { status: "PROCESSING", error: SUPERSEDED_PRINT_ERROR };
  }

  const error = result.error ?? "Unknown print error";
  if (await recordOutcome({ status: "FAILED", lastError: error })) return { status: "FAILED", error };
  return { status: "PROCESSING", error: SUPERSEDED_PRINT_ERROR };
}

/**
 * Attempts to print a queued/failed job through its configured provider.
 * Never touches order or inventory rows — printing is deliberately
 * decoupled from the order-submission transaction (PRD's "critical
 * principle": stock is deducted at submission, not at print success), so a
 * printer failure can never roll back a completed sale or deduct stock
 * again.
 *
 * Delivery guarantee: at most one caller holds a job at a time (claim +
 * lease), and a caller can only record the outcome of its own claim. That
 * is not exactly-once paper output: bytes can reach the printer and the
 * process die before recording success. Such a job is never retried
 * automatically — recovery marks it FAILED with an "outcome unknown"
 * error, and a person decides whether to retry.
 */
export async function processPrintJob(
  db: Database,
  businessId: string,
  printJobId: string,
  opts: PrintAttemptOptions = {},
): Promise<ProcessResult> {
  // The tenant comes from the caller, never from the job: a job id is not
  // an authorisation, and a cashier at one café must get "not found" for
  // another café's job even if they somehow hold its id. Filtering on the
  // job's own business_id makes that a single indexed predicate.
  const [row] = await db
    .select({ orderId: printJobs.orderId })
    .from(printJobs)
    .where(and(eq(printJobs.id, printJobId), eq(printJobs.businessId, businessId)))
    .limit(1);
  if (!row) throw new Error("Print job not found");

  const authorization = await authorizeAttempt(db, businessId, row.orderId, printJobId, opts.deviceCapable ?? false);
  if (authorization.kind === "refused") return authorization.result;
  return runClaimedAttempt(db, authorization);
}

/**
 * Records what the staff tablet's Bluetooth printer did with one specific
 * `device` attempt.
 *
 * The whole decision is one conditional UPDATE, so there is no window
 * between checking the job and writing to it: the outcome lands only if
 * the job still exists, belongs to this tenant, is a device job, is still
 * PROCESSING, and still carries this attempt's token. Anything else — a
 * duplicate report, a late failure after a success, a report for an
 * attempt that was superseded or recovered, a job cancelled meanwhile —
 * changes nothing and gets the job's actual current status back.
 */
export async function recordDevicePrintResult(
  db: Database,
  actor: { businessId: string },
  printJobId: string,
  attemptToken: string,
  outcome: { ok: boolean; error?: string },
): Promise<ProcessResult> {
  if (!UUID_PATTERN.test(printJobId)) throw new Error("Print job not found");
  if (!UUID_PATTERN.test(attemptToken)) throw new Error("Invalid print attempt token.");
  const error = outcome.error?.slice(0, MAX_PRINT_ERROR_LENGTH) || "The tablet could not print this receipt.";

  const [updated] = await db
    .update(printJobs)
    .set(
      outcome.ok
        ? { status: "PRINTED", printedAt: new Date(), lastError: null, claimToken: null, leaseExpiresAt: null }
        : { status: "FAILED", lastError: error, claimToken: null, leaseExpiresAt: null },
    )
    .where(
      and(
        eq(printJobs.id, printJobId),
        eq(printJobs.claimToken, attemptToken),
        eq(printJobs.status, "PROCESSING"),
        eq(printJobs.provider, "device"),
        sql`exists (select 1 from ${orders} where ${orders.id} = ${printJobs.orderId} and ${orders.businessId} = ${actor.businessId})`,
      ),
    )
    .returning({ status: printJobs.status });

  if (updated) return outcome.ok ? { status: "PRINTED" } : { status: "FAILED", error };

  // Nothing matched. Say why, using the job's real current state — the
  // tablet needs to know whether its receipt counts, and a stale report
  // must not be mistaken for a fresh failure.
  const [current] = await db
    .select({ status: printJobs.status, provider: printJobs.provider })
    .from(printJobs)
    .innerJoin(orders, eq(printJobs.orderId, orders.id))
    .where(and(eq(printJobs.id, printJobId), eq(orders.businessId, actor.businessId)))
    .limit(1);
  if (!current) throw new Error("Print job not found");
  // Only the tablet's own jobs — never let a client mark a server-side
  // provider's job as printed.
  if (current.provider !== "device") throw new Error("This print job is not printed by the tablet.");
  return { status: current.status, error: current.status === "PROCESSING" ? IN_FLIGHT_PRINT_ERROR : undefined };
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

export async function retryPrintJob(db: Database, actor: ActorContext, printJobId: string, opts: PrintAttemptOptions = {}) {
  const [job] = await db
    .select({ id: printJobs.id })
    .from(printJobs)
    .innerJoin(orders, eq(printJobs.orderId, orders.id))
    .where(and(eq(printJobs.id, printJobId), eq(orders.businessId, actor.businessId)))
    .limit(1);
  if (!job) throw new Error("Print job not found");

  // Sweep an expired claim on this job first, so a retry of an attempt that
  // was abandoned mid-print starts from an explicit "outcome unknown"
  // rather than silently waiting behind a dead lease. The cancelled-order
  // check itself happens under the order lock, inside processPrintJob.
  await recoverAbandonedPrintJobs(db, actor.businessId, printJobId);
  const result = await processPrintJob(db, actor.businessId, printJobId, opts);

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

/**
 * A retried reprint request reports on the job its first attempt created.
 * It never authorizes a second send of the same request: a job still being
 * printed reports as in progress, and a finished one reports its outcome.
 */
async function resultForExistingJob(
  db: Database,
  businessId: string,
  jobId: string,
  opts: PrintAttemptOptions,
): Promise<ProcessResult> {
  const [job] = await db
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.id, jobId), eq(printJobs.businessId, businessId)))
    .limit(1);
  if (!job) throw new Error("Print job not found");
  // Never processed (e.g. the request died right after creating it), or a
  // browser receipt still waiting on the client: processing is claim-guarded.
  if (job.status === "QUEUED") return processPrintJob(db, businessId, jobId, opts);
  if (job.status === "PROCESSING") return { status: "PROCESSING", error: IN_FLIGHT_PRINT_ERROR };
  return { status: job.status, error: job.lastError ?? undefined };
}

/**
 * Reprint: a new print job for the same order, never a new order and
 * never another inventory deduction (PRD §6.10). `requestKey` identifies
 * one deliberate reprint: retrying that request returns the job it already
 * created, while a new click (new key) queues a new receipt.
 *
 * Creating the job and claiming its first attempt both happen under the
 * order's row lock, so a cancellation committing at the same moment either
 * precedes this (and it is refused) or follows it (and finds an attempt
 * already in flight, which it leaves alone).
 */
export async function createReprintJob(
  db: Database,
  actor: ActorContext,
  orderId: string,
  requestKey?: string,
  opts: PrintAttemptOptions = {},
): Promise<ProcessResult> {
  const deviceCapable = opts.deviceCapable ?? false;

  const authorization = await db.transaction(async (tx): Promise<AttemptAuthorization | { kind: "existing"; jobId: string }> => {
    await lockOrderForPrinting(tx, actor.businessId, orderId);

    if (requestKey) {
      const existing = await findReprintJob(tx, actor.businessId, orderId, requestKey);
      if (existing) return { kind: "existing", jobId: existing.id };
    }

    const provider = configuredPrintProvider();
    if (provider === "device" && !deviceCapable) throw new PrintNotAllowedError(DEVICE_PRINT_ELSEWHERE_ERROR);

    const [lastJob] = await tx
      .select()
      .from(printJobs)
      .where(eq(printJobs.orderId, orderId))
      .orderBy(desc(printJobs.createdAt))
      .limit(1);

    const [job] = await tx
      .insert(printJobs)
      .values({
        businessId: actor.businessId,
        orderId,
        destination: lastJob?.destination ?? "CUSTOMER_RECEIPT",
        provider,
        status: "QUEUED",
        payloadSnapshot: lastJob?.payloadSnapshot ?? {},
        requestedBy: actor.userId,
        requestKey: requestKey ?? null,
      })
      .onConflictDoNothing({ target: [printJobs.orderId, printJobs.requestKey] })
      .returning();

    if (!job) {
      // A concurrent retry of the same request created it first.
      const existing = await findReprintJob(tx, actor.businessId, orderId, requestKey!);
      return { kind: "existing", jobId: existing!.id };
    }

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "order.reprinted",
      entityType: "print_job",
      entityId: job.id,
      metadata: { orderId },
    });

    return claimAttemptLocked(tx, job.id, deviceCapable);
  });

  if (authorization.kind === "existing") return resultForExistingJob(db, actor.businessId, authorization.jobId, opts);
  if (authorization.kind === "refused") return authorization.result;
  return runClaimedAttempt(db, authorization);
}
