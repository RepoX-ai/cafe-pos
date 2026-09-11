import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Dashboard — CaféOps",
};

/**
 * Full dashboard (summary cards, operational widgets — PRD §6.12) ships in
 * Phase 5, once orders/inventory exist to summarize.
 */
export default async function DashboardPage() {
  const user = await requirePageAccess("reports:read");

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Dashboard</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Welcome back, {user.name}.
      </p>

      <div className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-8 text-sm text-[var(--color-text-secondary)]">
        Sales, COGS, gross profit, and inventory summary cards land here in
        Phase 5, once menu, inventory, and order workflows exist.
      </div>
    </div>
  );
}
