import type { RoleName } from "./permissions";

export const ROLE_LABELS: Record<RoleName, string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  inventory_staff: "Inventory Staff",
  viewer: "Viewer",
};

export function formatRoles(roles: RoleName[]): string {
  return roles.map((r) => ROLE_LABELS[r]).join(", ");
}
