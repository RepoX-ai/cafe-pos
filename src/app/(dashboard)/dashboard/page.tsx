import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { logoutAction } from "@/app/(auth)/login/actions";

export const metadata: Metadata = {
  title: "Dashboard — CaféOps",
};

/**
 * Placeholder landing page for non-cashier roles. Full dashboard
 * (summary cards, operational widgets — PRD §6.12) ships in Phase 5, once
 * orders/inventory exist to summarize. This page exists now to prove the
 * auth + permission + role-routing foundation end-to-end.
 */
export default async function DashboardPage() {
  const user = await requirePageAccess("reports:read");

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Signed in as {user.name} · {user.roles.join(", ")}
          </p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-selected-surface)]"
          >
            Log out
          </button>
        </form>
      </div>

      <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-8 text-sm text-[var(--color-text-secondary)]">
        Sales, COGS, gross profit, and inventory summary cards land here in
        Phase 5, once menu, inventory, and order workflows exist.
      </div>
    </div>
  );
}
