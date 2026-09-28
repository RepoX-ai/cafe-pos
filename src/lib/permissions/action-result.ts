import { unstable_rethrow } from "next/navigation";
import { ServiceError } from "@/server/services/errors";
import { WorkLimitExceededError } from "@/lib/work-limiter";
import { StaleActionScopeError } from "@/lib/auth/action-scope";
import { PermissionDeniedError } from "./permissions";

/** Stable copy returned to Server Action callers — never the raw permission name. */
export const PERMISSION_DENIED_MESSAGE = "You don't have permission to do that.";
export const UNAUTHENTICATED_MESSAGE = "Your session has expired. Sign in again.";

export type ControlledActionError = { ok: false; error: string; scopeChanged?: true };

/**
 * What a fire-and-forget action (archive, delete) returns. Failures come
 * back as a value, not a throw: Next.js replaces a thrown error's message
 * in production builds, so the reason would never reach the toast.
 */
export type ActionOutcome = void | ControlledActionError;

/**
 * Maps authz failures (and bare "Not authenticated" from requireCurrentUser)
 * to a stable `{ ok: false }` result so Server Actions don't surface them as
 * uncaught 500s. Framework control-flow errors (redirect, notFound, …) are
 * rethrown via `unstable_rethrow`.
 */
export function mapControlledActionError(error: unknown): ControlledActionError | null {
  if (error instanceof PermissionDeniedError) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE };
  }
  if (error instanceof StaleActionScopeError) {
    return { ok: false, error: error.message, scopeChanged: true };
  }
  // Written for the user (not found in your business, conflict, validation).
  // Anything else still propagates, so Next.js masks it and onRequestError logs it.
  if (error instanceof ServiceError || error instanceof WorkLimitExceededError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof Error && error.message === "Not authenticated") {
    return { ok: false, error: UNAUTHENTICATED_MESSAGE };
  }
  return null;
}

/** Run a Server Action body and convert known authz failures into `{ ok: false }`. */
export async function asActionResult<T>(run: () => Promise<T>): Promise<T | ControlledActionError> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    const mapped = mapControlledActionError(error);
    if (mapped) return mapped;
    throw error;
  }
}
