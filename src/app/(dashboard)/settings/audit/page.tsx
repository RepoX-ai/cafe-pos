import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { pageWindow, parsePageParam, toPage } from "@/lib/pagination";
import { ServerPagination } from "@/components/ui/server-pagination";
import { countAuditLogs, listAuditLogs } from "@/server/services/audit";
import { AuditLogTable } from "./audit-log-table";

export const metadata: Metadata = {
  title: "Audit log — CaféOps",
};

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requirePageAccess("audit:read");
  const window = pageWindow(parsePageParam((await searchParams).page));
  const [rows, totalItems] = await Promise.all([listAuditLogs(db, user.businessId, window), countAuditLogs(db, user.businessId)]);
  const logs = toPage(rows, window.page, window.pageSize);

  return (
    <div className="mx-auto max-w-[1440px]">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
        <ArrowLeft size={14} />
        Back to settings
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">Audit log</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Recorded actions for this business, newest first.
      </p>

      <AuditLogTable
        logs={logs.rows}
        pagination={<ServerPagination page={{ ...logs, rowCount: logs.rows.length }} totalItems={totalItems} basePath="/settings/audit" />}
      />
    </div>
  );
}
