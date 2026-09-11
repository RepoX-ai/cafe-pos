import type { RoleName } from "@/lib/permissions/permissions";

/**
 * Shared source of truth for the dev seed accounts — used by
 * scripts/seed.ts (what actually gets created) and the dev-only account
 * switcher (src/components/dev-role-switcher.tsx), so the two can never
 * drift apart. Fictional development data only.
 */
export const DEV_SEED_PASSWORD = "ChangeMe123!";

export const DEV_SEED_ACCOUNTS: Array<{ name: string; email: string; role: RoleName }> = [
  { name: "Dev Owner", email: "owner@dev.local", role: "owner" },
  { name: "Dev Manager", email: "manager@dev.local", role: "manager" },
  { name: "Dev Cashier", email: "cashier@dev.local", role: "cashier" },
  { name: "Dev Inventory Staff", email: "inventory@dev.local", role: "inventory_staff" },
  { name: "Dev Viewer", email: "viewer@dev.local", role: "viewer" },
];
