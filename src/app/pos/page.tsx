import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { logoutAction } from "@/app/(auth)/login/actions";

export const metadata: Metadata = {
  title: "POS — CaféOps",
};

/**
 * Placeholder POS screen. The real iPad ordering workspace (menu grid,
 * cart, modifiers, submit-order transaction) ships in Phase 3, once menu
 * items, variants, and recipes exist to order against.
 */
export default async function PosPage() {
  const user = await requirePageAccess("orders:create");

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-page-bg)]">
      <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">CaféOps POS</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--color-text-secondary)]">{user.name}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-selected-surface)]"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-6">
        <p className="max-w-sm text-center text-sm text-[var(--color-text-secondary)]">
          Menu categories, product grid, and cart land here in Phase 3, once
          menu items and recipes exist.
        </p>
      </main>
    </div>
  );
}
