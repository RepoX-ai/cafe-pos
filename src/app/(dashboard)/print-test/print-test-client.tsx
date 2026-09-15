"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PrintJobPayload } from "@/printing/printer-provider";
import { renderReceipt, renderReceiptText, type ReceiptDestination } from "@/printing/escpos/receipt";
import { encodeAscii, feed, INIT } from "@/printing/escpos/commands";
import {
  canRememberDevices,
  getRememberedPrinters,
  isWebBluetoothAvailable,
  openPrinter,
  requestPrinter,
  type PrinterDevice,
  type PrinterEndpoint,
  type PrinterLink,
  type WriteMode,
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
  const [chunkSize, setChunkSize] = useState(20);
  const [delayMs, setDelayMs] = useState(40);
  const [acceptAll, setAcceptAll] = useState(false);
  const [destination, setDestination] = useState<ReceiptDestination>("CUSTOMER_RECEIPT");
  const [endpoints, setEndpoints] = useState<PrinterEndpoint[]>([]);
  const [endpointUuid, setEndpointUuid] = useState("");
  const [writeMode, setWriteMode] = useState<WriteMode>("auto");
  const lastDevice = useRef<PrinterDevice | null>(null);
  /** Mirrors lastDevice for render-time checks — refs can't be read while rendering. */
  const [hasDevice, setHasDevice] = useState(false);

  const append = useCallback((text: string, tone: LogEntry["tone"] = "info") => {
    setLog((entries) => [...entries, { at: new Date().toLocaleTimeString(), text, tone }]);
  }, []);

  const logEnvironment = useCallback(() => {
    append(`Web Bluetooth: ${isWebBluetoothAvailable() ? "available" : "NOT available"}`);
    append(`Silent reconnect (getDevices): ${canRememberDevices() ? "supported" : "not supported"}`);
    append(`Secure context (HTTPS): ${window.isSecureContext ? "yes" : "NO — Web Bluetooth will refuse to run"}`);
    append(navigator.userAgent);
  }, [append]);

  async function attach(device: PrinterDevice) {
    const opened = await openPrinter(device, {
      characteristicUuid: endpointUuid || undefined,
      mode: writeMode,
    });
    link.current = opened;
    lastDevice.current = device;
    setHasDevice(true);
    setEndpoints(opened.endpoints);
    setEndpointUuid(opened.characteristicUuid);
    setConnected(device.name ?? device.id);
    append(`Connected to ${device.name ?? device.id}`, "ok");
    append(`Writable characteristics found: ${opened.endpoints.length}`);
    for (const endpoint of opened.endpoints) {
      const modes = [endpoint.canWrite ? "write" : null, endpoint.canWriteWithoutResponse ? "write-no-response" : null]
        .filter(Boolean)
        .join(", ");
      append(`  ${endpoint.serviceUuid} / ${endpoint.characteristicUuid} (${modes})`);
    }
    append(`Using ${opened.serviceUuid} / ${opened.characteristicUuid} (${opened.mode})`, "ok");
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

  const sendBytes = (bytes: Uint8Array, label: string) =>
    run(label, async () => {
      const current = link.current;
      if (!current) throw new Error("Not connected.");
      append(`${label}: ${bytes.length} bytes in ${chunkSize}-byte chunks, ${delayMs}ms apart…`);
      const startedAt = performance.now();
      await current.write(bytes, { chunkSize, delayMs });
      append(`Sent in ${Math.round(performance.now() - startedAt)}ms. Check the paper.`, "ok");
    });

  const print = (payload: PrintJobPayload) => sendBytes(renderReceipt(payload, { destination }), "Print");

  /** Smallest thing that can possibly print: reset, one word, feed. */
  const printHello = () =>
    sendBytes(Uint8Array.from([...INIT, ...encodeAscii("HELLO\n"), ...feed(4)]), "Minimal test");

  /** Re-open the same device after changing endpoint or write mode — no chooser. */
  const reopen = () =>
    run("Reopen", async () => {
      const device = lastDevice.current;
      if (!device) throw new Error("Connect once first.");
      link.current?.disconnect();
      await attach(device);
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
          <Button size="sm" onClick={printHello} disabled={busy || !connected}>Print HELLO only</Button>
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

        <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-[var(--color-border)] pt-4">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
            Write to
            <select
              value={endpointUuid}
              onChange={(event) => setEndpointUuid(event.target.value)}
              className="h-8 max-w-[320px] rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-sm text-[var(--color-text-primary)]"
            >
              {endpoints.length === 0 ? <option value="">connect first</option> : null}
              {endpoints.map((endpoint) => (
                <option key={endpoint.characteristicUuid} value={endpoint.characteristicUuid}>
                  {endpoint.characteristicUuid.slice(0, 13)}… ({endpoint.canWrite ? "write" : "no-response"})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-secondary)]">
            Write mode
            <select
              value={writeMode}
              onChange={(event) => setWriteMode(event.target.value as WriteMode)}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="auto">Auto</option>
              <option value="without-response">Without response</option>
              <option value="with-response">With response</option>
            </select>
          </label>
          <Button size="sm" variant="secondary" onClick={reopen} disabled={busy || !hasDevice}>
            Apply and reconnect
          </Button>
        </div>

        <p className="mt-3 max-w-[70ch] text-xs text-[var(--color-text-secondary)]">
          Nothing coming out? Keep chunk size at 20 — larger writes get split into a &ldquo;long write&rdquo; that this
          printer accepts and then discards. Try <strong>Print HELLO only</strong> first, then switch write mode to
          &ldquo;Without response&rdquo; and <strong>Apply and reconnect</strong>. If it still prints nothing, pick a
          different characteristic from the list.
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
