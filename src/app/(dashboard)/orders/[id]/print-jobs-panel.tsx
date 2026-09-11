"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { retryPrintJobAction, reprintOrderAction } from "../actions";

interface PrintJobRow {
  id: string;
  destination: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
}

export function PrintJobsPanel({
  orderId,
  printJobs,
  canManagePrinter,
  canReprint,
}: {
  orderId: string;
  printJobs: PrintJobRow[];
  canManagePrinter: boolean;
  canReprint: boolean;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isReprinting, setIsReprinting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retry(jobId: string) {
    setPendingId(jobId);
    const result = await retryPrintJobAction(jobId, orderId);
    setPendingId(null);
    setMessage(result.ok ? `Retry result: ${result.status}` : result.error);
  }

  async function reprint() {
    setIsReprinting(true);
    const result = await reprintOrderAction(orderId);
    setIsReprinting(false);
    setMessage(result.ok ? `Reprint result: ${result.status}` : result.error);
  }

  return (
    <div className="flex flex-col gap-2">
      {printJobs.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">No print jobs yet.</p>
      ) : (
        printJobs.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm">
            <div>
              <span className="text-[var(--color-text-primary)]">{p.destination}</span>
              {p.lastError ? <p className="text-xs text-[var(--color-danger)]">{p.lastError}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-muted)]">attempt {p.attemptCount}</span>
              <Badge tone={p.status === "PRINTED" ? "success" : p.status === "FAILED" ? "danger" : "accent"}>{p.status}</Badge>
              {canManagePrinter && p.status === "FAILED" ? (
                <Button size="sm" variant="secondary" onClick={() => retry(p.id)} disabled={pendingId === p.id}>
                  {pendingId === p.id ? "Retrying…" : "Retry"}
                </Button>
              ) : null}
            </div>
          </div>
        ))
      )}

      {canReprint ? (
        <div className="mt-2">
          <Button size="sm" variant="secondary" onClick={reprint} disabled={isReprinting}>
            {isReprinting ? "Reprinting…" : "Reprint"}
          </Button>
        </div>
      ) : null}

      {message ? <p className="text-xs text-[var(--color-text-secondary)]">{message}</p> : null}
    </div>
  );
}
