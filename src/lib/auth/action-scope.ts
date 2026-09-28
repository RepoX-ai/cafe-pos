import { matchesCheckoutScope } from "./checkout-scope";

/**
 * Stale-tab protection for tenant-changing actions. Every tab shares one
 * session, so switching café in one tab silently re-points every other open
 * tab. Each page renders the scope it was built for; its actions send that
 * back, and the server compares it with the session it just re-validated.
 *
 * The submitted scope can only REJECT a request. It never selects a
 * business, never authorizes anything, and is never written anywhere — the
 * session row stays the sole authority for tenant and permissions.
 *
 * Same `businessId:userId` format as the POS checkout guard, so one page
 * scope works for both.
 */
export const STALE_SCOPE_MESSAGE =
  "The café or account changed in another tab, so nothing was saved. Refresh this page to continue with the café you're signed into now.";

export class StaleActionScopeError extends Error {
  constructor() {
    super(STALE_SCOPE_MESSAGE);
    this.name = "StaleActionScopeError";
  }
}

export function actionScopeFor(user: { id: string; businessId: string }): string {
  return `${user.businessId}:${user.id}`;
}

/** Call after the session and permission checks, before any read or write that depends on the tenant. */
export function assertActionScope(user: { id: string; businessId: string }, expectedScope: unknown): void {
  if (!matchesCheckoutScope(user, expectedScope)) throw new StaleActionScopeError();
}
