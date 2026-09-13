import type { PrinterConnectionResult, PrinterProvider, PrinterStatus, PrintResult } from "../printer-provider";

/**
 * Placeholder for a real hardware adapter (local print bridge / network
 * thermal printer / iOS SDK bridge). Per PRD §6.11 and §20, the exact
 * printer brand, model, connection type, and SDK are open decisions the
 * café has not yet provided — do not guess at a protocol here.
 *
 * Once that information is available, implement this class against
 * PRINT_BRIDGE_URL / PRINT_BRIDGE_SECRET (see .env.example) without
 * touching order or print-job code — that's the entire point of the
 * provider interface.
 */
export class BridgePrinterProvider implements PrinterProvider {
  readonly name = "bridge" as const;

  async testConnection(): Promise<PrinterConnectionResult> {
    return {
      connected: false,
      message: "No hardware bridge configured yet — printer brand/model/connection type are still open decisions (PRD §20).",
    };
  }

  async print(): Promise<PrintResult> {
    return { success: false, error: "Hardware print bridge is not configured yet." };
  }

  async getStatus(): Promise<PrinterStatus> {
    return { online: false, detail: "Not configured" };
  }
}
