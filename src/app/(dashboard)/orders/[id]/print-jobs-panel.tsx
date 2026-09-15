"use client";

import { BrowserReceipt } from "@/components/browser-receipt";
import type { PrintJobPayload } from "@/printing/printer-provider";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { retryPrintJobAction, reprintOrderAction } from "../actions";
import { useToast } from "@/components/ui/toast";

interface PrintJobRow {
  id: string;
  destination: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  /** Abandoned mid-print: it may or may not have printed. */
  outcomeUnknown?: boolean;
}

function newRequestKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `reprint-${Date.now()}-${Math.random()}`;
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
  const [receipt, setReceipt] = useState<PrintJobPayload | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isReprinting, setIsReprinting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // One key per deliberate Reprint. It survives a failed/unknown response so
  // clicking again retries that same request instead of queueing a second receipt.
  const reprintKey = useRef<string | null>(null);
  const showToast = useToast();

  async function retry(jobId: string) {
    setPendingId(jobId);
    try {
      const result = await retryPrintJobAction(jobId, orderId);
      if (result.ok && result.payload) setReceipt(result.payload);
      const text = result.ok ? `Retry result: ${result.status}${result.error ? ` — ${result.error}` : ""}` : result.error;
      setMessage(text);
      showToast(result.ok ? "success" : "error", text);
    } catch {
      const text = "Could not confirm the print request. Refresh to check its status.";
      setMessage(text);
      showToast("error", text);
    } finally { setPendingId(null); }
  }

  async function reprint() {
    setIsReprinting(true);
    try {
      reprintKey.current ??= newRequestKey();
      const result = await reprintOrderAction(orderId, reprintKey.current);
      reprintKey.current = null;
      if (result.ok && result.payload) setReceipt(result.payload);
      const text = result.ok ? `Reprint result: ${result.status}${result.error ? ` — ${result.error}` : ""}` : result.error;
      setMessage(text);
      showToast(result.ok ? "success" : "error", text);
    } catch {
      const text = "Could not confirm the print request. Refresh to check its status.";
      setMessage(text);
      showToast("error", text);
    } finally { setIsReprinting(false); }
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
              {p.outcomeUnknown ? (
                <p className="text-xs text-[var(--color-warning)]">Print outcome unknown — check whether this receipt printed before retrying.</p>
              ) : p.lastError ? (
                <p className="text-xs text-[var(--color-danger)]">{p.lastError}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-muted)]">attempt {p.attemptCount}</span>
              <Badge tone={p.outcomeUnknown ? "warning" : p.status === "PRINTED" ? "success" : p.status === "FAILED" ? "danger" : "accent"}>
                {p.outcomeUnknown ? "UNKNOWN" : p.status}
              </Badge>
              {canManagePrinter && (p.status === "FAILED" || p.status === "QUEUED" || p.outcomeUnknown) ? (
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

      {receipt ? <BrowserReceipt payload={receipt} /> : null}
      {message ? <p className="text-xs text-[var(--color-text-secondary)]">{message}</p> : null}
    </div>
  );
}
