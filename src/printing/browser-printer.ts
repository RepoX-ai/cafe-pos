import type { PrinterConnectionResult, PrinterProvider, PrinterStatus, PrintResult } from "./printer-provider";

/**
 * Browser print fallback (PRD §6.11): there is no real thermal-printer
 * integration here. The server side just marks the job as needing a
 * client-triggered `window.print()`; the client renders a printable
 * receipt view and calls the browser's print dialog. This is explicitly
 * NOT automatic thermal printing — the UI must label it as a fallback.
 */
export class BrowserPrinterProvider implements PrinterProvider {
  readonly name = "browser" as const;

  async testConnection(): Promise<PrinterConnectionResult> {
    return {
      connected: true,
      message: "Browser fallback — no hardware connection to test. The staff device's browser print dialog will be used.",
    };
  }

  async print(): Promise<PrintResult> {
    return { success: false, requiresClientAction: "window_print" };
  }

  async getStatus(): Promise<PrinterStatus> {
    return { online: true, detail: "Browser fallback (no hardware)" };
  }
}
