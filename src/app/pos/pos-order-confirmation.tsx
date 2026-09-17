"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserReceipt } from "@/components/browser-receipt";
import type { PrintJobPayload } from "@/printing/printer-provider";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/money/money";
import { reportDevicePrintResultAction, retryDevicePrintAction } from "./actions";
import type { PosPrinter } from "./use-bluetooth-printer";

type Confirmation = {
  orderNumber: string;
  total: number;
  cashReceived: number | null;
  changeDue: number | null;
  printStatus: string;
  receipt?: PrintJobPayload;
  devicePrintJobId?: string;
  devicePrintToken?: string;
};

/**
 * `unknown` is its own outcome: the bytes went out but the server never
 * recorded what happened, so nobody can say whether paper came out. Staff
 * decide whether to send it again — nothing resends on its own.
 */
type DevicePrintState = "idle" | "printing" | "printed" | "failed" | "unknown";

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
  const { devicePrintJobId, devicePrintToken, receipt } = confirmation;
  const isDeviceJob = Boolean(devicePrintJobId && devicePrintToken && receipt);
  const canAutoPrint = isDeviceJob && printer.isConnected;

  const [state, setState] = useState<DevicePrintState>(canAutoPrint ? "printing" : "idle");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  /**
   * Sends one authorized attempt. `authorization` is the claim the server
   * handed out — the one from checkout the first time, a freshly claimed one
   * for every retry. Bytes are never sent twice against the same claim.
   */
  const sendAuthorizedAttempt = useCallback(
    async (authorization: { printJobId: string; attemptToken: string; payload: PrintJobPayload }) => {
      setState("printing");
      setError(null);
      const result = await printer.printReceipt(authorization.payload);
      // Record the outcome even on failure, so the order screen shows a
      // receipt that needs attention rather than a silent gap.
      const reported = await reportDevicePrintResultAction(authorization.printJobId, authorization.attemptToken, result);
      if (reported.status === "UNKNOWN") {
        // The bytes went out; the result never landed. Saying "printed" or
        // "failed" here would both be guesses.
        setState("unknown");
        setError("The receipt was sent but the result could not be recorded. Check the printer before sending it again.");
        return;
      }
      setState(result.ok ? "printed" : "failed");
      setError(result.ok ? null : (result.error ?? "The printer did not accept the receipt."));
    },
    [printer],
  );

  useEffect(() => {
    if (!canAutoPrint || started.current) return;
    started.current = true;
    void sendAuthorizedAttempt({ printJobId: devicePrintJobId!, attemptToken: devicePrintToken!, payload: receipt! });
  }, [canAutoPrint, devicePrintJobId, devicePrintToken, receipt, sendAuthorizedAttempt]);

  /**
   * A deliberate staff retry. It re-authorizes first: the previous attempt
   * is closed (or expired) by now, and re-using its token would resend bytes
   * nothing is tracking.
   */
  async function retryPrint() {
    if (!devicePrintJobId) return;
    if (!printer.isConnected) {
      try {
        await printer.connect();
      } catch (connectError) {
        setState("failed");
        setError(connectError instanceof Error ? connectError.message : "Could not connect to the printer.");
        return;
      }
    }
    setState("printing");
    setError(null);
    const authorization = await retryDevicePrintAction(devicePrintJobId);
    if (!authorization.ok) {
      setState(authorization.status === "PRINTED" ? "printed" : "failed");
      setError(authorization.status === "PRINTED" ? null : authorization.error);
      return;
    }
    await sendAuthorizedAttempt(authorization);
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
                  : state === "unknown"
                    ? "font-medium text-[var(--color-warning)]"
                    : state === "printed"
                      ? "font-medium text-[var(--color-success)]"
                      : "font-medium text-[var(--color-text-primary)]"
              }
            >
              {state === "printing"
                ? "printing…"
                : state === "printed"
                  ? "printed"
                  : state === "failed"
                    ? "not printed"
                    : state === "unknown"
                      ? "outcome unknown"
                      : "waiting for printer"}
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
              {error ? (
                <p className={`max-w-xs text-xs ${state === "unknown" ? "text-[var(--color-warning)]" : "text-[var(--color-danger)]"}`}>{error}</p>
              ) : null}
              <p className="max-w-xs text-xs text-[var(--color-text-muted)]">
                The order is saved either way. Reprint it from the order&apos;s detail page if needed.
              </p>
              <Button variant="secondary" onClick={retryPrint}>
                {state === "unknown"
                  ? "Send again anyway"
                  : printer.isConnected
                    ? "Print receipt"
                    : "Connect printer and print"}
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
