import type { PrinterLink } from "./web-bluetooth";

/**
 * The tablet's printer connection, held outside React so it survives
 * navigation between POS screens — /pos to /pos/orders/[id] and back.
 *
 * Without this, walking into order history would drop the connection and
 * reprinting would need another trip through the browser's device chooser,
 * because this tablet's Chrome can't reopen a printer silently.
 *
 * A full page reload still clears it; only a tap can re-grant access.
 */

export type PrinterSnapshot = {
  deviceName: string | null;
  /** Paired, but the radio link dropped; the next print reconnects. */
  isAsleep: boolean;
  isSimulated: boolean;
  lastSimulatedReceipt: string | null;
};

const EMPTY: PrinterSnapshot = { deviceName: null, isAsleep: false, isSimulated: false, lastSimulatedReceipt: null };

let link: PrinterLink | null = null;
let snapshot: PrinterSnapshot = EMPTY;
const listeners = new Set<() => void>();

export function subscribePrinter(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPrinterSnapshot(): PrinterSnapshot {
  return snapshot;
}

/** Server render has no printer; a stable object keeps hydration quiet. */
export function getServerPrinterSnapshot(): PrinterSnapshot {
  return EMPTY;
}

export function getPrinterLink(): PrinterLink | null {
  return link;
}

function emit(next: PrinterSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function setPrinterLink(next: PrinterLink | null, details: { deviceName: string | null; isSimulated?: boolean }) {
  link = next;
  emit({
    ...snapshot,
    deviceName: details.deviceName,
    isSimulated: details.isSimulated ?? false,
    isAsleep: false,
  });
}

export function updatePrinter(patch: Partial<PrinterSnapshot>) {
  emit({ ...snapshot, ...patch });
}
