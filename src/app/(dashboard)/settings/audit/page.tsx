import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listAuditLogs } from "@/server/services/audit";
import { formatBusinessDateTime } from "@/lib/dates/dates";

export const metadata: Metadata = {
  title: "Audit log — CaféOps",
};

export default async function AuditLogPage() {
  const user = await requirePageAccess("audit:read");
  const logs = await listAuditLogs(db, user.businessId);

  return (
    <div className="mx-auto max-w-[1440px]">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
        <ArrowLeft size={14} />
        Back to settings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">Audit log</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        The most recent 200 recorded actions for this business.
      </p>

      <div className="mt-6 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                  No audit events yet.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-[var(--color-border)] last:border-0 align-top">
                  <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{formatBusinessDateTime(log.createdAt)}</td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{log.actorName ?? "System"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-[var(--color-selected-surface)] px-2 py-0.5 text-xs font-medium text-[var(--color-accent-primary)]">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                    {log.entityType}
                    {log.entityId ? `:${log.entityId.slice(0, 8)}` : ""}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                    {log.metadata ? JSON.stringify(log.metadata) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
