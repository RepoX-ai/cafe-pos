"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PrintJobPayload } from "@/printing/printer-provider";
import { renderReceipt, renderReceiptText, type ReceiptDestination } from "@/printing/escpos/receipt";
import {
  canRememberDevices,
  getRememberedPrinters,
  isWebBluetoothAvailable,
  openPrinter,
  requestPrinter,
  type PrinterLink,
} from "@/printing/ble/web-bluetooth";

const SAMPLE: PrintJobPayload = {
  orderId: "sample",
  orderNumber: "TEST-0001",
  locationName: "Matsudon",
  createdAt: new Date().toISOString(),
  orderType: "Dine-in",
  tableLabel: "Table 4",
  lines: [
    { name: "Nasi Goreng", variantName: "Large", quantity: 2, modifiers: ["Extra spicy", "No egg"], note: "less oil", unitPrice: 25000, lineTotal: 50000 },
    { name: "Es Teh Manis", quantity: 1, modifiers: [], lineTotal: 8000 },
    { name: "Ayam Bakar Madu Spesial Pedas", quantity: 1, modifiers: ["Level 3"], unitPrice: 42000, lineTotal: 42000 },
  ],
  subtotal: 100000,
  discount: 5000,
  tax: 9500,
  total: 104500,
  footer: "Terima kasih",
};

type LogEntry = { at: string; text: string; tone: "info" | "ok" | "error" };

export function PrintTestClient() {
  const link = useRef<PrinterLink | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chunkSize, setChunkSize] = useState(120);
  const [delayMs, setDelayMs] = useState(20);
  const [acceptAll, setAcceptAll] = useState(false);
  const [destination, setDestination] = useState<ReceiptDestination>("CUSTOMER_RECEIPT");

  const append = useCallback((text: string, tone: LogEntry["tone"] = "info") => {
    setLog((entries) => [...entries, { at: new Date().toLocaleTimeString(), text, tone }]);
  }, []);

  const logEnvironment = useCallback(() => {
    append(`Web Bluetooth: ${isWebBluetoothAvailable() ? "available" : "NOT available"}`);
    append(`Silent reconnect (getDevices): ${canRememberDevices() ? "supported" : "not supported"}`);
    append(`Secure context (HTTPS): ${window.isSecureContext ? "yes" : "NO — Web Bluetooth will refuse to run"}`);
    append(navigator.userAgent);
  }, [append]);

  async function attach(device: Awaited<ReturnType<typeof requestPrinter>>) {
    const opened = await openPrinter(device);
    link.current = opened;
    setConnected(device.name ?? device.id);
    append(`Connected to ${device.name ?? device.id}`, "ok");
    append(`Service ${opened.serviceUuid}`);
    append(`Write characteristic ${opened.characteristicUuid} (${opened.mode})`);
    device.addEventListener("gattserverdisconnected", () => {
      link.current = null;
      setConnected(null);
      append("Printer disconnected (sleep, out of range, or powered off).", "error");
    });
    const notifying = await opened.onNotify((bytes) => {
      append(`Printer says: ${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    });
    append(`Status notifications: ${notifying ? "listening" : "unavailable on this unit"}`);
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      append(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    run("Connect", async () => {
      logEnvironment();
      append(acceptAll ? "Opening chooser (all BLE devices)…" : "Opening chooser (printers only)…");
      await attach(await requestPrinter(acceptAll));
    });

  const reconnect = () =>
    run("Reconnect", async () => {
      const remembered = await getRememberedPrinters();
      append(`Remembered devices: ${remembered.length ? remembered.map((d) => d.name ?? d.id).join(", ") : "none"}`);
      const device = remembered[0];
      if (!device) throw new Error("Nothing remembered — use Connect printer once first.");
      await attach(device);
    });

  const print = (payload: PrintJobPayload) =>
    run("Print", async () => {
      const current = link.current;
      if (!current) throw new Error("Not connected.");
      const bytes = renderReceipt(payload, { destination });
      append(`Sending ${bytes.length} bytes in ${chunkSize}-byte chunks, ${delayMs}ms apart…`);
      const startedAt = performance.now();
      await current.write(bytes, { chunkSize, delayMs });
      append(`Sent in ${Math.round(performance.now() - startedAt)}ms. Check the paper.`, "ok");
    });

  function copyLog() {
    const text = log.map((entry) => `${entry.at}  ${entry.text}`).join("\n");
    navigator.clipboard?.writeText(text).then(
      () => append("Log copied.", "ok"),
      () => append("Could not copy — select the text manually.", "error"),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-[var(--color-text-secondary)]">Printer:</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              connected
                ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
                : "bg-[var(--color-selected-surface)] text-[var(--color-text-secondary)]"
            }`}
          >
            {connected ?? "not connected"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={connect} disabled={busy}>Connect printer</Button>
          <Button size="sm" variant="secondary" onClick={reconnect} disabled={busy}>Reconnect silently</Button>
          <Button size="sm" variant="secondary" onClick={() => print(SAMPLE)} disabled={busy || !connected}>
            Print sample receipt
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !connected}
            onClick={() => print({ ...SAMPLE, lines: SAMPLE.lines.slice(0, 1), orderNumber: "TEST-SHORT" })}
          >
            Print short receipt
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { link.current?.disconnect(); }} disabled={busy || !connected}>
            Disconnect
          </Button>
          <Button size="sm" variant="secondary" onClick={logEnvironment}>Check environment</Button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
            Chunk size (bytes)
            <input
              type="number"
              value={chunkSize}
              min={20}
              max={512}
              onChange={(event) => setChunkSize(Number(event.target.value))}
              className="h-8 w-28 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
            Delay between chunks (ms)
            <input
              type="number"
              value={delayMs}
              min={0}
              max={500}
              onChange={(event) => setDelayMs(Number(event.target.value))}
              className="h-8 w-28 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
            Ticket type
            <select
              value={destination}
              onChange={(event) => setDestination(event.target.value as ReceiptDestination)}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="CUSTOMER_RECEIPT">Customer receipt</option>
              <option value="KITCHEN_TICKET">Kitchen ticket</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" checked={acceptAll} onChange={(event) => setAcceptAll(event.target.checked)} />
            Show all BLE devices in the chooser
          </label>
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          If printing comes out garbled or stops halfway, lower the chunk size or raise the delay, then print again.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Expected paper output</h2>
          <pre className="overflow-x-auto whitespace-pre rounded-[var(--radius-sm)] bg-[var(--color-page-bg)] p-4 font-mono text-xs text-[var(--color-text-primary)]">
            {renderReceiptText(SAMPLE, { destination })}
          </pre>
        </section>

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Log</h2>
            <Button size="sm" variant="secondary" onClick={copyLog}>Copy log</Button>
          </div>
          <div className="flex flex-col gap-1 font-mono text-xs">
            {log.map((entry, index) => (
              <p
                key={index}
                className={
                  entry.tone === "error"
                    ? "text-[var(--color-danger)]"
                    : entry.tone === "ok"
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-text-secondary)]"
                }
              >
                <span className="opacity-60">{entry.at} </span>
                {entry.text}
              </p>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
