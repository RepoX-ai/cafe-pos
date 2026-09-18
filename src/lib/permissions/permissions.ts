/**
 * Allowlist-based permission model (PRD §4). A role has NO access unless a
 * permission is explicitly granted here — never infer access because a
 * role is merely absent from a deny list.
 *
 * This is enforced on the server for every mutation and every
 * business-data read. The UI additionally hides nav/actions the current
 * user can't use, but hiding is a UX nicety, not the security boundary.
 */

export type RoleName =
  | "super_admin"
  | "owner"
  | "manager"
  | "cashier"
  | "inventory_staff"
  | "viewer";

export const PERMISSIONS = [
  "orders:create",
  "orders:read_own",
  "orders:read_all",
  "orders:read_all_basic",
  "orders:cancel",
  "orders:refund",
  "orders:reprint",
  "menu:read",
  "menu:write",
  "recipes:write",
  "ingredients:write",
  "inventory:read",
  "inventory:receive",
  "inventory:adjust",
  "inventory:waste",
  "purchases:write",
  "expenses:write",
  "reports:read",
  "staff:write",
  "settings:write",
  "printer:manage",
  "audit:read",
  // Install-level, not business-level: creating a new tenant. Held by
  // owner and super_admin only, so the client can stand up another café
  // themselves without shell access to the server.
  "business:create",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Default policy from the PRD's role access matrix (§4). Entries marked
 * "Permission-based" / "Optional" in the PRD are given a sensible MVP
 * default below; per-business overrides are a later feature.
 */
export const ROLE_PERMISSIONS: Record<RoleName, ReadonlySet<Permission>> = {
  super_admin: new Set(PERMISSIONS), // every permission, always
  // Every permission within their business, plus "business:create" — the
  // one entry here that reaches beyond it. An owner can create further
  // businesses (becoming their owner too); they still cannot see or touch
  // a business they hold no membership in.
  owner: new Set(PERMISSIONS),
  manager: new Set<Permission>([
    "orders:create",
    "orders:read_own",
    "orders:read_all",
    "orders:cancel", // permission-based in PRD; on by default for managers
    "orders:refund", // permission-based in PRD; on by default for managers
    "orders:reprint",
    "menu:read",
    "menu:write",
    "recipes:write", // permission-based in PRD; on by default for managers
    "ingredients:write",
    "inventory:read",
    "inventory:receive",
    "inventory:adjust",
    "inventory:waste",
    "purchases:write",
    "expenses:write",
    "reports:read",
    "printer:manage",
    "audit:read", // PRD: read-only or permission-based; default read-only
    // deliberately excluded: staff:write, settings:write
  ]),
  cashier: new Set<Permission>([
    "orders:create",
    "orders:read_own",
    // Lets a cashier browse the full order list (e.g. to look up an order
    // for a customer complaint) from within the POS itself — NOT the same
    // as orders:read_all. The POS-side order history view built for this
    // permission never renders COGS/gross-profit/margin, so it doesn't
    // cross the PRD §4 line ("should not see ... ingredient costs ...
    // profit information"). Don't reuse this permission to gate anything
    // that surfaces financials.
    "orders:read_all_basic",
    // Deliberately NOT menu:read: the POS reads the menu catalog via
    // orders:create (its own page permission), not menu:read — menu:read
    // is what gates the /menu ADMIN section, which surfaces recipe COGS
    // and margins. Granting it here would let a cashier reach that data,
    // which the PRD explicitly forbids (§4: "should not see ... ingredient
    // costs ... profit information").
    //
    // Reprint is granted to cashiers by default (PRD §4 role matrix,
    // changed 2026-09-15 at the café's request: staff reprint receipts
    // themselves rather than waiting for a manager). It covers any order
    // they can already see through orders:read_all_basic, creates a new
    // print job from the order's snapshot, and never re-deducts stock.
    // Every reprint is audit-logged with who asked for it.
    "orders:reprint",
  ]),
  inventory_staff: new Set<Permission>([
    // Same reasoning as cashier above: inventory_staff can manage
    // ingredients directly, but "Menu management" is explicitly "No" in
    // the PRD's role matrix, so no menu:read either.
    "ingredients:write",
    "inventory:read",
    "inventory:receive",
    "inventory:adjust",
    "inventory:waste",
    "purchases:write",
    // orders:create is optional/assignment-based; not granted by default.
  ]),
  viewer: new Set<Permission>([
    // Same reasoning: "Menu management" is "No" for Viewer too.
    "orders:read_all",
    "inventory:read",
    "reports:read",
  ]),
};

export function hasPermission(role: RoleName, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** A user may hold multiple roles; access is the union of all their roles' permissions. */
export function hasAnyRolePermission(roles: RoleName[], permission: Permission): boolean {
  return roles.some((role) => hasPermission(role, permission));
}

export class PermissionDeniedError extends Error {
  constructor(permission: Permission) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

/** Throws PermissionDeniedError if none of the roles grant the permission. Use at the top of every server action/route handler. */
export function requirePermission(roles: RoleName[], permission: Permission): void {
  if (!hasAnyRolePermission(roles, permission)) {
    throw new PermissionDeniedError(permission);
  }
}
