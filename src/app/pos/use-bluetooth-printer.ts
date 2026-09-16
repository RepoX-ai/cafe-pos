"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  isWebBluetoothAvailable,
  onPrinterDisconnected,
  openPrinter,
  requestPrinter,
} from "@/printing/ble/web-bluetooth";
import { createSimulatedPrinter } from "@/printing/ble/simulated-printer";
import {
  getPrinterLink,
  getPrinterSnapshot,
  getServerPrinterSnapshot,
  setPrinterLink,
  subscribePrinter,
  updatePrinter,
} from "@/printing/ble/printer-store";
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
 * Reads the tablet's printer connection, which lives in a module-level
 * store so it outlives any one screen: staff tap "Connect printer" once
 * per shift and can then print from checkout or from order history.
 */
export function useBluetoothPrinter(): PosPrinter {
  const snapshot = useSyncExternalStore(subscribePrinter, getPrinterSnapshot, getServerPrinterSnapshot);

  const connect = useCallback(async () => {
    if (simulationRequested()) {
      setPrinterLink(
        createSimulatedPrinter((receipt) => updatePrinter({ lastSimulatedReceipt: receipt })),
        { deviceName: "Simulated printer", isSimulated: true },
      );
      return;
    }
    if (!isWebBluetoothAvailable()) {
      throw new Error("This browser can't use Bluetooth printers. Use Chrome on the Android tablet.");
    }
    const device = await requestPrinter();
    setPrinterLink(await openPrinter(device), { deviceName: device.name ?? "Printer" });
    // The printer sleeps between orders and drops the link. Keep the
    // pairing: the next print reconnects on its own, so staff don't have to
    // tap Connect again mid-shift.
    onPrinterDisconnected(device, () => updatePrinter({ isAsleep: true }));
  }, []);

  const printReceipt = useCallback(async (payload: PrintJobPayload) => {
    const link = getPrinterLink();
    if (!link) return { ok: false, error: "No printer connected on this tablet." };
    try {
      await link.write(renderReceipt(payload));
      updatePrinter({ isAsleep: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Bluetooth write failed." };
    }
  }, []);

  return useMemo(
    () => ({
      isConnected: snapshot.deviceName !== null,
      isAsleep: snapshot.isAsleep,
      isSimulated: snapshot.isSimulated,
      deviceName: snapshot.deviceName,
      lastSimulatedReceipt: snapshot.lastSimulatedReceipt,
      connect,
      printReceipt,
    }),
    [snapshot, connect, printReceipt],
  );
}
