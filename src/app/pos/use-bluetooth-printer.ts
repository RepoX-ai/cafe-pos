"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  isWebBluetoothAvailable,
  onPrinterDisconnected,
  openPrinter,
  requestPrinter,
  type PrinterLink,
} from "@/printing/ble/web-bluetooth";
import { createSimulatedPrinter } from "@/printing/ble/simulated-printer";
import { renderReceipt } from "@/printing/escpos/receipt";
import type { PrintJobPayload } from "@/printing/printer-provider";

export type PosPrinter = {
  isConnected: boolean;
  /** Paired, but the link dropped; the next print reconnects automatically. */
  isAsleep: boolean;
  isSimulated: boolean;
  deviceName: string | null;
  /** The last receipt a simulated printer "printed", for local testing. */
  lastSimulatedReceipt: string | null;
  /** Opens the browser's device chooser. Must be called from a tap. */
  connect: () => Promise<void>;
  printReceipt: (payload: PrintJobPayload) => Promise<{ ok: boolean; error?: string }>;
};

/**
 * `?printer=sim` runs checkout against a fake printer — no hardware needed.
 *
 * Refused in production unless NEXT_PUBLIC_ALLOW_PRINTER_SIM is set, so a
 * live till can never mark receipts printed without paper coming out.
 */
function simulationRequested() {
  if (typeof window === "undefined") return false;
  const allowed = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ALLOW_PRINTER_SIM === "1";
  return allowed && new URLSearchParams(window.location.search).get("printer") === "sim";
}

/**
 * Holds the POS tablet's Bluetooth printer connection for as long as the
 * page stays open, so staff tap "Connect printer" once per shift rather
 * than once per order. A page reload drops it: this tablet's Chrome has no
 * silent reconnect, so the tap comes back after a refresh.
 */
export function useBluetoothPrinter(): PosPrinter {
  const link = useRef<PrinterLink | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  /** Paired but the radio link has dropped — printing wakes it back up. */
  const [asleep, setAsleep] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [lastSimulatedReceipt, setLastSimulatedReceipt] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (simulationRequested()) {
      link.current = createSimulatedPrinter(setLastSimulatedReceipt);
      setSimulated(true);
      setDeviceName("Simulated printer");
      return;
    }
    if (!isWebBluetoothAvailable()) {
      throw new Error("This browser can't use Bluetooth printers. Use Chrome on the Android tablet.");
    }
    const device = await requestPrinter();
    link.current = await openPrinter(device);
    setDeviceName(device.name ?? "Printer");
    // The printer sleeps between orders and drops the link. Keep the
    // pairing: the next print reconnects on its own, so staff don't have to
    // tap Connect again mid-shift.
    onPrinterDisconnected(device, () => setAsleep(true));
  }, []);

  const printReceipt = useCallback(async (payload: PrintJobPayload) => {
    const current = link.current;
    if (!current) return { ok: false, error: "No printer connected on this tablet." };
    try {
      await current.write(renderReceipt(payload));
      setAsleep(false);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Bluetooth write failed." };
    }
  }, []);

  return useMemo(
    () => ({
      isConnected: deviceName !== null,
      isAsleep: asleep,
      isSimulated: simulated,
      deviceName,
      lastSimulatedReceipt,
      connect,
      printReceipt,
    }),
    [deviceName, asleep, simulated, lastSimulatedReceipt, connect, printReceipt],
  );
}
