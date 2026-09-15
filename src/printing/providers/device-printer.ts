import type { PrinterConnectionResult, PrinterProvider, PrinterStatus, PrintResult } from "../printer-provider";

/**
 * The Bluetooth printer paired with the staff tablet (iWare/Rongta
 * RPP02N). The printer is reachable only from the browser via Web
 * Bluetooth — never from the server — so this provider cannot print. It
 * hands the job back for the tablet to send, and the tablet reports the
 * outcome through `recordDevicePrintResult`.
 *
 * Status is therefore genuine: the job is only PRINTED once bytes were
 * accepted by the printer over BLE, unlike the browser fallback.
 */
export class DevicePrinterProvider implements PrinterProvider {
  readonly name = "device" as const;

  async testConnection(): Promise<PrinterConnectionResult> {
    return {
      connected: false,
      message: "The printer pairs with the staff tablet, not the server. Test it from Printer test on that tablet.",
    };
  }

  async print(): Promise<PrintResult> {
    return { success: false, requiresClientAction: "device_print" };
  }

  async getStatus(): Promise<PrinterStatus> {
    return { online: false, detail: "Reported by the tablet, not the server" };
  }
}
