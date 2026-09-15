/**
 * Printer provider interface (PRD §6.11). Order/print-job logic depends
 * only on this interface — swapping in real hardware later (once the
 * café confirms a printer model) means adding a new file under
 * `src/printing/providers/`, not touching order or print-job code.
 */

export type PrintJobPayload = {
  orderId: string;
  orderNumber: string;
  locationName: string;
  createdAt: string;
  orderType?: string;
  tableLabel?: string;
  lines: Array<{
    name: string;
    variantName?: string;
    quantity: number;
    modifiers: string[];
    note?: string;
    unitPrice?: number;
    lineTotal?: number;
  }>;
  subtotal?: number;
  discount?: number;
  tax?: number;
  total?: number;
  footer?: string;
};

export interface PrinterConnectionResult {
  connected: boolean;
  message?: string;
}

export interface PrintResult {
  success: boolean;
  /**
   * Set when the provider can't print itself and the client must:
   * `window_print` is the browser-dialog fallback, `device_print` is the
   * tablet's own Bluetooth printer.
   */
  requiresClientAction?: "window_print" | "device_print";
  error?: string;
}

export interface PrinterStatus {
  online: boolean;
  detail?: string;
}

export type PrintProviderName = "mock" | "browser" | "bridge" | "device";

export interface PrinterProvider {
  readonly name: PrintProviderName;
  testConnection(): Promise<PrinterConnectionResult>;
  print(payload: PrintJobPayload): Promise<PrintResult>;
  getStatus(): Promise<PrinterStatus>;
}
