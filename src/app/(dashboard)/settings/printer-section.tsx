"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { testPrinterConnectionAction } from "./actions";

export function PrinterSection({ providerName }: { providerName: string }) {
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ connected: boolean; message?: string } | null>(null);

  async function test() {
    setIsPending(true);
    const res = await testPrinterConnectionAction();
    setIsPending(false);
    setResult(res);
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Printer</h2>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
        Configured via the <code className="font-mono text-xs">PRINT_PROVIDER</code> environment variable. The exact
        hardware printer is still an open decision (PRD §20) — until it&apos;s confirmed, orders print through a mock
        provider or the browser&apos;s print dialog.
      </p>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-[var(--color-text-secondary)]">Current provider:</span>
        <span className="rounded-full bg-[var(--color-selected-surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-accent-primary)]">
          {providerName}
        </span>
      </div>
      <Button variant="secondary" size="sm" onClick={test} disabled={isPending}>
        {isPending ? "Testing…" : "Test printer connection"}
      </Button>
      {result ? (
        <p className={`mt-2 text-sm ${result.connected ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
          {result.connected ? "Connected. " : "Not connected. "}
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
