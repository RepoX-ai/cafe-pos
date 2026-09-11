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
  /** Set when the provider can't print itself and the client must (browser fallback). */
  requiresClientAction?: "window_print";
  error?: string;
}

export interface PrinterStatus {
  online: boolean;
  detail?: string;
}

export interface PrinterProvider {
  readonly name: "mock" | "browser" | "bridge";
  testConnection(): Promise<PrinterConnectionResult>;
  print(payload: PrintJobPayload): Promise<PrintResult>;
  getStatus(): Promise<PrinterStatus>;
}
