"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { isWebBluetoothAvailable, openPrinter, requestPrinter, type PrinterLink } from "@/printing/ble/web-bluetooth";
import { renderReceipt } from "@/printing/escpos/receipt";
import type { PrintJobPayload } from "@/printing/printer-provider";

export type PosPrinter = {
  isConnected: boolean;
  deviceName: string | null;
  /** Opens the browser's device chooser. Must be called from a tap. */
  connect: () => Promise<void>;
  printReceipt: (payload: PrintJobPayload) => Promise<{ ok: boolean; error?: string }>;
};

/**
 * Holds the POS tablet's Bluetooth printer connection for as long as the
 * page stays open, so staff tap "Connect printer" once per shift rather
 * than once per order. A page reload drops it: this tablet's Chrome has no
 * silent reconnect, so the tap comes back after a refresh.
 */
export function useBluetoothPrinter(): PosPrinter {
  const link = useRef<PrinterLink | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (!isWebBluetoothAvailable()) {
      throw new Error("This browser can't use Bluetooth printers. Use Chrome on the Android tablet.");
    }
    const device = await requestPrinter();
    link.current = await openPrinter(device);
    setDeviceName(device.name ?? "Printer");
    device.addEventListener("gattserverdisconnected", () => {
      link.current = null;
      setDeviceName(null);
    });
  }, []);

  const printReceipt = useCallback(async (payload: PrintJobPayload) => {
    const current = link.current;
    if (!current) return { ok: false, error: "No printer connected on this tablet." };
    try {
      await current.write(renderReceipt(payload));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Bluetooth write failed." };
    }
  }, []);

  return useMemo(
    () => ({ isConnected: deviceName !== null, deviceName, connect, printReceipt }),
    [deviceName, connect, printReceipt],
  );
}
