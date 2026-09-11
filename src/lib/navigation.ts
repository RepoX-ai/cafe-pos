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
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  permission: Permission;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "reports:read" },
  { href: "/orders", label: "Orders", icon: "orders", permission: "orders:read_all" },
  { href: "/menu", label: "Menu", icon: "menu", permission: "menu:read" },
  { href: "/ingredients", label: "Ingredients", icon: "ingredients", permission: "inventory:read" },
  { href: "/inventory", label: "Inventory", icon: "inventory", permission: "inventory:read" },
  { href: "/purchases", label: "Purchases", icon: "purchases", permission: "purchases:write" },
  { href: "/waste", label: "Waste", icon: "waste", permission: "inventory:waste" },
  { href: "/expenses", label: "Expenses", icon: "expenses", permission: "expenses:write" },
  { href: "/reports", label: "Reports", icon: "reports", permission: "reports:read" },
  { href: "/settings", label: "Settings", icon: "settings", permission: "settings:write" },
];
