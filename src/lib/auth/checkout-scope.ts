/** A client scope may only reject stale work; it never selects a tenant. */
export function matchesCheckoutScope(
  user: { id: string; businessId: string },
  expectedScope: unknown,
): boolean {
  return typeof expectedScope === "string" && expectedScope === `${user.businessId}:${user.id}`;
}
