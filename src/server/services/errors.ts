import { randomUUID } from "node:crypto";
import { describeError, log } from "@/lib/observability/log";
import { WorkLimitExceededError } from "@/lib/work-limiter";

/**
 * An error whose message was written for the person using the app and is
 * safe to show them. Anything else — a pg/Drizzle error (whose message
 * carries the SQL and its parameters), a bug, a timeout — is logged and
 * replaced with a generic message by `toUserMessage`.
 */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The row doesn't exist *in the caller's business* — deliberately indistinguishable from "exists elsewhere". */
export class NotFoundError extends ServiceError {}

/** Another request changed the same thing first; retrying is the right response. */
export class ConflictError extends ServiceError {}

/** An idempotency key was reused for a different payload. */
export class IdempotencyMismatchError extends ServiceError {
  constructor() {
    super("This request was already submitted with different details. Reload the page and try again.");
  }
}

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Nothing was saved — try again, and contact the owner if it keeps happening.";

function pgCode(error: unknown): string | undefined {
  for (let current = error as { code?: string; cause?: unknown } | undefined; current; current = current.cause as typeof current) {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) return current.code;
  }
  return undefined;
}

/**
 * Message to return to a Server Action caller. Service errors pass through;
 * lock/statement timeouts and serialization failures become a retry hint;
 * everything else is logged with a reference id the user can quote.
 */
export function toUserMessage(error: unknown, context: string, fallback = GENERIC_ERROR_MESSAGE): string {
  if (error instanceof ServiceError || error instanceof WorkLimitExceededError) return error.message;
  const code = pgCode(error);
  // A malformed id from a tampered form or URL (invalid uuid syntax).
  if (code === "22P02") return "That item no longer exists or the request was malformed. Reload and try again.";
  if (code === "55P03" || code === "57014" || code === "40001" || code === "40P01") {
    log("warn", "request.contended", { context, ...describeError(error) });
    return "The system is busy with another change to the same data. Try again in a moment.";
  }
  const ref = randomUUID().slice(0, 8);
  log("error", "request.failed", { context, ref, ...describeError(error) });
  return `${fallback} (ref ${ref})`;
}
