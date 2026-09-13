import type { PrinterConnectionResult, PrinterProvider, PrinterStatus, PrintResult } from "./printer-provider";

/**
 * Always "succeeds" — for automated tests and local development before a
 * real printer is configured (PRD §6.11 "Mock printer provider for
 * automated tests"). Never used in production once a real provider is
 * configured via PRINT_PROVIDER.
 */
export class MockPrinterProvider implements PrinterProvider {
  readonly name = "mock" as const;

  async testConnection(): Promise<PrinterConnectionResult> {
    return { connected: true, message: "Mock printer — always connected." };
  }

  async print(): Promise<PrintResult> {
    return { success: true };
  }

  async getStatus(): Promise<PrinterStatus> {
    return { online: true, detail: "Mock printer" };
  }
}
