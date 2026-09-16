"use client";

import { useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reprintReceiptAction, reportDevicePrintResultAction } from "@/app/pos/actions";
import { useBluetoothPrinter } from "@/app/pos/use-bluetooth-printer";

type State = "idle" | "working" | "printed" | "failed";

/**
 * Reprints a past receipt from POS order history. The receipt comes from
 * the order's stored snapshot, so it reproduces what was sold at the time
 * even if the menu or prices have changed since (PRD §6.10).
 */
export function ReprintReceipt({ orderId }: { orderId: string }) {
  const printer = useBluetoothPrinter();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);
  /** One key per tap: a retry of the same tap must not queue a second receipt. */
  const requestKey = useRef<string | null>(null);

  async function reprint() {
    setState("working");
    setMessage(null);
    requestKey.current ??= crypto.randomUUID();

    const queued = await reprintReceiptAction(orderId, requestKey.current);
    if (!queued.ok) {
      requestKey.current = null;
      setState("failed");
      setMessage(queued.error);
      return;
    }

    // Server-side providers finish on the server; only the tablet's own
    // printer needs us to send the bytes and report back.
    if (!queued.devicePrintJobId || !queued.payload) {
      requestKey.current = null;
      const printed = queued.status === "PRINTED";
      setState(printed ? "printed" : "failed");
      setMessage(printed ? null : (queued.error ?? `Print job is ${queued.status.toLowerCase()}.`));
      return;
    }

    if (!printer.isConnected) {
      try {
        await printer.connect();
      } catch (error) {
        setState("failed");
        setMessage(error instanceof Error ? error.message : "Could not connect to the printer.");
        return;
      }
    }

    const result = await printer.printReceipt(queued.payload);
    await reportDevicePrintResultAction(queued.devicePrintJobId, result);
    requestKey.current = null;
    setState(result.ok ? "printed" : "failed");
    setMessage(result.ok ? null : (result.error ?? "The printer did not accept the receipt."));
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={reprint} disabled={state === "working"}>
        <Printer size={14} />
        {state === "working" ? "Printing…" : state === "printed" ? "Print again" : "Reprint receipt"}
      </Button>
      {state === "printed" ? (
        <p className="text-xs text-[var(--color-success)]">Sent to the printer.</p>
      ) : null}
      {state === "failed" && message ? (
        <p className="max-w-[280px] text-right text-xs text-[var(--color-danger)]">{message}</p>
      ) : null}
      {!printer.isConnected && state === "idle" ? (
        <p className="text-xs text-[var(--color-text-muted)]">Connects the printer when you tap.</p>
      ) : null}
    </div>
  );
}
