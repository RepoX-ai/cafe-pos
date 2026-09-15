"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserReceipt } from "@/components/browser-receipt";
import type { PrintJobPayload } from "@/printing/printer-provider";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/money/money";
import { reportDevicePrintResultAction } from "./actions";
import type { PosPrinter } from "./use-bluetooth-printer";

type Confirmation = {
  orderNumber: string;
  total: number;
  cashReceived: number | null;
  changeDue: number | null;
  printStatus: string;
  receipt?: PrintJobPayload;
  devicePrintJobId?: string;
};

type DevicePrintState = "idle" | "printing" | "printed" | "failed";

/** Full-screen result after a successful submission; "New order" resets the POS. */
export function PosOrderConfirmation({
  confirmation,
  resetOrder,
  printer,
}: {
  confirmation: Confirmation;
  resetOrder: () => void;
  printer: PosPrinter;
}) {
  const { devicePrintJobId, receipt } = confirmation;
  const isDeviceJob = Boolean(devicePrintJobId && receipt);
  const canAutoPrint = isDeviceJob && printer.isConnected;

  const [state, setState] = useState<DevicePrintState>(canAutoPrint ? "printing" : "idle");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const sendToPrinter = useCallback(async () => {
    if (!devicePrintJobId || !receipt) return;
    setState("printing");
    setError(null);
    const result = await printer.printReceipt(receipt);
    // Record the outcome even on failure, so the order screen shows a
    // receipt that needs attention rather than a silent gap.
    await reportDevicePrintResultAction(devicePrintJobId, result);
    setState(result.ok ? "printed" : "failed");
    setError(result.ok ? null : (result.error ?? "The printer did not accept the receipt."));
  }, [devicePrintJobId, receipt, printer]);

  useEffect(() => {
    if (!canAutoPrint || started.current) return;
    started.current = true;
    void sendToPrinter();
  }, [canAutoPrint, sendToPrinter]);

  async function connectThenPrint() {
    try {
      await printer.connect();
    } catch (connectError) {
      setState("failed");
      setError(connectError instanceof Error ? connectError.message : "Could not connect to the printer.");
      return;
    }
    await sendToPrinter();
  }

  const serverStatus = confirmation.printStatus === "FAILED" ? "Failed — needs attention" : confirmation.printStatus.toLowerCase();

  return (
    <div className="force-light-theme flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-page-bg)] px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-success-bg)]">
        <span className="text-3xl">✓</span>
      </div>
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Order submitted</h1>
      <p className="text-lg text-[var(--color-text-secondary)]">{confirmation.orderNumber}</p>
      <p className="text-3xl font-semibold tabular-nums text-[var(--color-text-primary)]">{formatIDR(confirmation.total)}</p>

      {confirmation.changeDue !== null ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Cash received <span className="font-medium tabular-nums text-[var(--color-text-primary)]">{formatIDR(confirmation.cashReceived ?? 0)}</span>
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Change</p>
          <p className="text-4xl font-semibold tabular-nums text-[var(--color-success)]">{formatIDR(confirmation.changeDue)}</p>
        </div>
      ) : null}

      {isDeviceJob ? (
        <>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Print status:{" "}
            <span
              className={
                state === "failed"
                  ? "font-medium text-[var(--color-danger)]"
                  : state === "printed"
                    ? "font-medium text-[var(--color-success)]"
                    : "font-medium text-[var(--color-text-primary)]"
              }
            >
              {state === "printing" ? "printing…" : state === "printed" ? "printed" : state === "failed" ? "not printed" : "waiting for printer"}
            </span>
          </p>
          {printer.isSimulated && state === "printed" && printer.lastSimulatedReceipt ? (
            <details className="max-w-[360px] text-left">
              <summary className="cursor-pointer text-xs text-[var(--color-text-secondary)]">
                Simulated paper output
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs text-[var(--color-text-primary)]">
                {printer.lastSimulatedReceipt}
              </pre>
            </details>
          ) : null}
          {state !== "printing" && state !== "printed" ? (
            <div className="flex flex-col items-center gap-2">
              {error ? <p className="max-w-xs text-xs text-[var(--color-danger)]">{error}</p> : null}
              <p className="max-w-xs text-xs text-[var(--color-text-muted)]">
                The order is saved either way. Reprint it from the order&apos;s detail page if needed.
              </p>
              <Button variant="secondary" onClick={printer.isConnected ? sendToPrinter : connectThenPrint}>
                {printer.isConnected ? "Print receipt" : "Connect printer and print"}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Print status:{" "}
            <span className={confirmation.printStatus === "FAILED" ? "font-medium text-[var(--color-danger)]" : "font-medium text-[var(--color-success)]"}>
              {serverStatus}
            </span>
          </p>
          {confirmation.printStatus === "FAILED" ? (
            <p className="max-w-xs text-xs text-[var(--color-text-muted)]">
              The order was saved. An admin can retry printing from the order&apos;s detail page.
            </p>
          ) : null}
          {receipt ? <BrowserReceipt payload={receipt} /> : null}
        </>
      )}

      <Button size="lg" onClick={resetOrder} className="mt-4">
        New order
      </Button>
    </div>
  );
}
