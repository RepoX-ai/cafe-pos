"use client";

import type { ReactNode } from "react";
import { formatBusinessDateTime } from "@/lib/dates/dates";

interface AuditLogRow {
  id: string;
  createdAt: string | Date;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
}

/** One server-fetched page of audit events, with its pagination footer. */
export function AuditLogTable({ logs, pagination }: { logs: AuditLogRow[]; pagination?: ReactNode }) {
  return (
    <div className="mt-6 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="overflow-x-auto">
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
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-text-muted)]">{formatBusinessDateTime(new Date(log.createdAt))}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{log.actorName ?? "System"}</td>
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
      {pagination}
    </div>
  );
}
