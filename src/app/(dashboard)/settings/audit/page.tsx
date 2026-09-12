import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listAuditLogs } from "@/server/services/audit";
import { AuditLogTable } from "./audit-log-table";

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

      <AuditLogTable logs={logs} />
    </div>
  );
}
