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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Default policy from the PRD's role access matrix (§4). Entries marked
 * "Permission-based" / "Optional" in the PRD are given a sensible MVP
 * default below and can be overridden per-business later via
 * `settings:write` (see `overrides` param on `hasPermission`) without
 * changing this table's shape.
 */
export const ROLE_PERMISSIONS: Record<RoleName, ReadonlySet<Permission>> = {
  super_admin: new Set(PERMISSIONS), // every permission, always
  owner: new Set(PERMISSIONS), // every permission within their business
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
    // Deliberately NOT menu:read: the POS reads the menu catalog via
    // orders:create (its own page permission), not menu:read — menu:read
    // is what gates the /menu ADMIN section, which surfaces recipe COGS
    // and margins. Granting it here would let a cashier reach that data,
    // which the PRD explicitly forbids (§4: "should not see ... ingredient
    // costs ... profit information").
    //
    // orders:reprint is granted only if the owner explicitly enables
    // "reprint_own" for cashiers — see overrides below.
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
    // orders:create is optional/assignment-based — see overrides below.
  ]),
  viewer: new Set<Permission>([
    // Same reasoning: "Menu management" is "No" for Viewer too.
    "orders:read_all",
    "inventory:read",
    "reports:read",
  ]),
};

/**
 * Per-business toggles for the handful of permissions the PRD explicitly
 * calls out as owner-configurable (cashier reprint, inventory-staff order
 * entry, etc). Until a settings UI persists these, callers can pass an
 * explicit overrides object; omitted keys fall back to `ROLE_PERMISSIONS`.
 */
export interface PermissionOverrides {
  cashierCanReprintOwn?: boolean;
  inventoryStaffCanCreateOrders?: boolean;
}

export function hasPermission(
  role: RoleName,
  permission: Permission,
  overrides?: PermissionOverrides,
): boolean {
  if (overrides?.cashierCanReprintOwn && role === "cashier" && permission === "orders:reprint") {
    return true;
  }
  if (
    overrides?.inventoryStaffCanCreateOrders &&
    role === "inventory_staff" &&
    permission === "orders:create"
  ) {
    return true;
  }
  return ROLE_PERMISSIONS[role].has(permission);
}

/** A user may hold multiple roles; access is the union of all their roles' permissions. */
export function hasAnyRolePermission(
  roles: RoleName[],
  permission: Permission,
  overrides?: PermissionOverrides,
): boolean {
  return roles.some((role) => hasPermission(role, permission, overrides));
}

export class PermissionDeniedError extends Error {
  constructor(permission: Permission) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

/** Throws PermissionDeniedError if none of the roles grant the permission. Use at the top of every server action/route handler. */
export function requirePermission(
  roles: RoleName[],
  permission: Permission,
  overrides?: PermissionOverrides,
): void {
  if (!hasAnyRolePermission(roles, permission, overrides)) {
    throw new PermissionDeniedError(permission);
  }
}
