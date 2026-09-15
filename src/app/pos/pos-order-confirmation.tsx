"use client";

import { BrowserReceipt } from "@/components/browser-receipt";
import type { PrintJobPayload } from "@/printing/printer-provider";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/money/money";

/** Full-screen result after a successful submission; "New order" resets the POS. */
export function PosOrderConfirmation({
  confirmation,
  resetOrder,
}: {
  confirmation: { orderNumber: string; total: number; printStatus: string; receipt?: PrintJobPayload };
  resetOrder: () => void;
}) {
  return (
    <div className="force-light-theme flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-page-bg)] px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-success-bg)]">
        <span className="text-3xl">✓</span>
      </div>
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Order submitted</h1>
      <p className="text-lg text-[var(--color-text-secondary)]">{confirmation.orderNumber}</p>
      <p className="text-3xl font-semibold tabular-nums text-[var(--color-text-primary)]">{formatIDR(confirmation.total)}</p>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Print status:{" "}
        <span className={confirmation.printStatus === "FAILED" ? "font-medium text-[var(--color-danger)]" : "font-medium text-[var(--color-success)]"}>
          {confirmation.printStatus === "FAILED" ? "Failed — needs attention" : confirmation.printStatus.toLowerCase()}
        </span>
      </p>
      {confirmation.printStatus === "FAILED" ? (
        <p className="max-w-xs text-xs text-[var(--color-text-muted)]">
          The order was saved. An admin can retry printing from the order&apos;s detail page.
        </p>
      ) : null}
      {confirmation.receipt ? <BrowserReceipt payload={confirmation.receipt} /> : null}
      <Button size="lg" onClick={resetOrder} className="mt-4">
        New order
      </Button>
    </div>
  );
}
