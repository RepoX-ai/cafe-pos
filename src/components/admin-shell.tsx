"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Wheat,
  Boxes,
  Truck,
  Trash2,
  Receipt,
  BarChart3,
  Settings,
  Store,
  LogOut,
} from "lucide-react";
import type { Permission } from "@/lib/permissions/permissions";
import { logoutAction } from "@/app/(auth)/login/actions";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  permission: Permission;
}

const ICONS = {
  dashboard: LayoutDashboard,
  menu: UtensilsCrossed,
  ingredients: Wheat,
  inventory: Boxes,
  purchases: Truck,
  waste: Trash2,
  expenses: Receipt,
  reports: BarChart3,
  settings: Settings,
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "reports:read" },
  { href: "/menu", label: "Menu", icon: "menu", permission: "menu:read" },
  { href: "/ingredients", label: "Ingredients", icon: "ingredients", permission: "inventory:read" },
];

interface AdminShellProps {
  children: React.ReactNode;
  userName: string;
  roleLabel: string;
  businessName: string;
  visibleNavItems: NavItem[];
}

export function AdminShell({
  children,
  userName,
  roleLabel,
  businessName,
  visibleNavItems,
}: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[var(--color-page-bg)]">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex h-14 items-center gap-2 border-b border-[var(--color-border)] px-4">
          <Store size={18} className="text-[var(--color-accent-primary)]" />
          <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {businessName}
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {visibleNavItems.map((item) => {
            const Icon = ICONS[item.icon];
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--color-border)] p-3">
          <div className="mb-2 px-1">
            <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
              {userName}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">{roleLabel}</p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-danger)]"
            >
              <LogOut size={16} />
              Log out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
