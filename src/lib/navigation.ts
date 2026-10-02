import type { Permission } from "@/lib/permissions/permissions";

/**
 * Plain data — deliberately NOT in admin-shell.tsx. That file is
 * "use client", and a Server Component importing a plain export (not a
 * component) from a client module gets a client-reference proxy, not the
 * real array — `NAV_ITEMS.filter(...)` throws at runtime for every
 * authenticated request (caught by tests/e2e/login.spec.ts, not by
 * `next build`, since build never renders an auth-gated dynamic route).
 * Keep nav data here, icons/interactivity in admin-shell.tsx.
 */

export type NavIconKey =
  | "dashboard"
  | "orders"
  | "menu"
  | "ingredients"
  | "inventory"
  | "purchases"
  | "waste"
  | "expenses"
  | "reports"
  | "settings"
  | "staff"
  | "audit";

/** Section a nav item is grouped under in the sidebar — see NAV_GROUP_ORDER for display order/labels. */
export type NavGroupKey = "overview" | "catalog" | "inventory" | "finance" | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  permission: Permission;
  /** Hide this item from anyone who also holds this permission — it already gets a fuller entry elsewhere in the sidebar. */
  hiddenWith?: Permission;
  group: NavGroupKey;
}

/** Display order and label for each section — admin-shell.tsx renders one header per group that has at least one visible item. */
export const NAV_GROUP_ORDER: Array<{ key: NavGroupKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "catalog", label: "Catalog" },
  { key: "inventory", label: "Inventory" },
  { key: "finance", label: "Finance" },
  { key: "settings", label: "Settings" },
];

/**
 * Fallback order for the role-aware landing route (src/app/page.tsx): the
 * first entry a role has permission for is where they land after login.
 * Deliberately a separate list from NAV_ITEMS (whose order drives sidebar
 * grouping, not landing priority) — e.g. inventory:read maps to both
 * /inventory and /ingredients, and inventory-only roles should land on
 * /inventory, not wherever NAV_ITEMS happens to list ingredients first.
 * Roles with no permission in this list land on /forbidden.
 */
export const LANDING_ROUTES: Array<{ href: string; permission: Permission }> = [
  { href: "/dashboard", permission: "reports:read" },
  { href: "/orders", permission: "orders:read_all" },
  { href: "/inventory", permission: "inventory:read" },
  { href: "/menu", permission: "menu:read" },
  { href: "/purchases", permission: "purchases:write" },
  { href: "/waste", permission: "inventory:waste" },
  { href: "/expenses", permission: "expenses:write" },
  { href: "/settings/staff", permission: "staff:write" },
  { href: "/settings", permission: "settings:write" },
  { href: "/settings/audit", permission: "audit:read" },
];

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "reports:read", group: "overview" },
  { href: "/orders", label: "Orders", icon: "orders", permission: "orders:read_all", group: "overview" },
  // The COGS-free order history for roles that may browse orders but not
  // see financials (e.g. inventory_staff). It lives outside this shell under
  // /pos, so roles without orders:create still reach it via this link.
  {
    href: "/pos/orders",
    label: "Order history",
    icon: "orders",
    permission: "orders:read_all_basic",
    hiddenWith: "orders:read_all",
    group: "overview",
  },
  { href: "/menu", label: "Menu", icon: "menu", permission: "menu:read", group: "catalog" },
  { href: "/ingredients", label: "Ingredients", icon: "ingredients", permission: "inventory:read", group: "catalog" },
  { href: "/inventory", label: "Inventory", icon: "inventory", permission: "inventory:read", group: "inventory" },
  { href: "/purchases", label: "Purchases", icon: "purchases", permission: "purchases:write", group: "inventory" },
  { href: "/waste", label: "Waste", icon: "waste", permission: "inventory:waste", group: "inventory" },
  { href: "/expenses", label: "Expenses", icon: "expenses", permission: "expenses:write", group: "finance" },
  { href: "/reports", label: "Reports", icon: "reports", permission: "reports:read", group: "finance" },
  { href: "/settings", label: "Settings", icon: "settings", permission: "settings:write", group: "settings" },
  { href: "/settings/staff", label: "Staff", icon: "staff", permission: "staff:write", group: "settings" },
  { href: "/settings/audit", label: "Audit log", icon: "audit", permission: "audit:read", group: "settings" },
];
