"use client";

import { useEffect, useRef, useState } from "react";
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
  KeyRound,
  LogOut,
  ClipboardList,
  ShoppingBag,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  History,
  ChevronDown,
} from "lucide-react";
import { logoutAction } from "@/app/(auth)/login/actions";
import { BusinessSwitcher, type BusinessOption } from "@/components/business-switcher";
import { BrandLogo } from "@/components/brand-logo";
import { NAV_GROUP_ORDER, type NavItem } from "@/lib/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

const ICONS = {
  dashboard: LayoutDashboard,
  orders: ClipboardList,
  menu: UtensilsCrossed,
  ingredients: Wheat,
  inventory: Boxes,
  purchases: Truck,
  waste: Trash2,
  expenses: Receipt,
  reports: BarChart3,
  settings: Settings,
  staff: Users,
  audit: History,
};

const COLLAPSED_STORAGE_KEY = "cafepos.admin-sidebar-collapsed";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

interface AdminShellProps {
  children: React.ReactNode;
  userName: string;
  roleLabel: string;
  businessName: string;
  /** This business's own logo; null falls back to the bundled wordmark. */
  logoUrl: string | null;
  /** Inline custom properties that re-theme the shell — see lib/branding. */
  brandStyle?: React.CSSProperties;
  visibleNavItems: NavItem[];
  canUsePos: boolean;
  /** Every business this account can act in; one entry means no switcher. */
  businessOptions: BusinessOption[];
  activeMembershipId: string;
}

export function AdminShell({
  children,
  userName,
  roleLabel,
  businessName,
  logoUrl,
  brandStyle,
  visibleNavItems,
  canUsePos,
  businessOptions,
  activeMembershipId,
}: AdminShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen]);

  // Restore the user's last choice after mount (avoids an SSR/client
  // markup mismatch — first paint always matches the server's default).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // ignore — default to expanded
    }
  }, []);

  // An item whose href is a path-prefix of another visible item's href
  // (e.g. /settings is a prefix of /settings/staff) only counts as
  // "active" on an exact match — otherwise both would highlight at once
  // while viewing the child page. Leaf items keep matching their own
  // sub-routes too (e.g. /orders/[id] still highlights "Orders").
  const exactMatchOnlyHrefs = new Set(
    visibleNavItems
      .filter((item) => visibleNavItems.some((other) => other.href !== item.href && other.href.startsWith(`${item.href}/`)))
      .map((item) => item.href),
  );

  function isActive(href: string) {
    if (pathname === href) return true;
    if (exactMatchOnlyHrefs.has(href)) return false;
    return pathname.startsWith(`${href}/`);
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore — collapse state just won't persist
      }
      return next;
    });
  }

  return (
    // The theme provider is in the root layout, not here — see the comment
    // there. Dark mode is still admin-only: /pos and /login pin themselves
    // light with `.force-light-theme`.
    <>
      <div style={brandStyle} className="flex h-screen overflow-hidden bg-[var(--color-page-bg)]">
        <aside
          className={`flex h-screen shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width] duration-150 ${
            collapsed ? "w-[68px]" : "w-[220px]"
          }`}
        >
          <div
            className={`flex h-14 shrink-0 items-center border-b border-[var(--color-border)] px-4 ${
              collapsed ? "justify-center" : "justify-between gap-2"
            }`}
          >
            {!collapsed ? (
              <>
                <div className="flex min-w-0 items-center">
                  <BrandLogo className="h-8" alt={businessName} name={businessName} src={logoUrl} />
                </div>
                <button
                  onClick={toggleCollapsed}
                  title="Collapse sidebar"
                  className="shrink-0 rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
                >
                  <PanelLeftClose size={16} />
                </button>
              </>
            ) : (
              <button
                onClick={toggleCollapsed}
                title="Expand sidebar"
                className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
              >
                <PanelLeftOpen size={18} />
              </button>
            )}
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
            {canUsePos ? (
              <Link
                href="/pos"
                title="Open POS"
                className={`mb-2 flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-page-bg)] ${
                  collapsed ? "justify-center" : ""
                }`}
              >
                <ShoppingBag size={16} className="shrink-0" />
                {!collapsed ? "Open POS" : null}
              </Link>
            ) : null}
            {NAV_GROUP_ORDER.map((group) => {
              const itemsInGroup = visibleNavItems.filter((item) => item.group === group.key);
              if (itemsInGroup.length === 0) return null;
              return (
                <div key={group.key} className="mb-3">
                  {!collapsed ? (
                    <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      {group.label}
                    </p>
                  ) : (
                    <div className="mx-2 mb-1.5 border-t border-[var(--color-border)]" />
                  )}
                  <div className="flex flex-col gap-0.5">
                    {itemsInGroup.map((item) => {
                      const Icon = ICONS[item.icon];
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          title={item.label}
                          className={`flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                            collapsed ? "justify-center" : ""
                          } ${
                            active
                              ? "bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
                          }`}
                        >
                          <Icon size={16} className="shrink-0" />
                          {!collapsed ? item.label : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
            <ThemeToggle />
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pl-1.5 pr-1.5 text-left hover:bg-[var(--color-page-bg)]"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-selected-surface)] text-xs font-semibold text-[var(--color-accent-primary)]">
                  {initials(userName)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{userName}</p>
                  <p className="truncate text-xs text-[var(--color-text-muted)]">
                    {businessOptions.length > 1 ? `${roleLabel} · ${businessName}` : roleLabel}
                  </p>
                </div>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {userMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1.5 w-56 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg"
                >
                  {businessOptions.length > 1 ? (
                    <>
                      <BusinessSwitcher options={businessOptions} activeMembershipId={activeMembershipId} />
                      <div className="my-1 border-t border-[var(--color-border)]" />
                    </>
                  ) : null}
                  <Link
                    href="/account/password"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
                  >
                    <KeyRound size={16} className="shrink-0" />
                    Change password
                  </Link>
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      role="menuitem"
                      className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-danger)]"
                    >
                      <LogOut size={16} className="shrink-0" />
                      Log out
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6 md:px-12 md:py-8 xl:px-20">{children}</main>
        </div>
      </div>
    </>
  );
}
