import type { PrinterProvider } from "./printer-provider";
import { MockPrinterProvider } from "./mock-printer";
import { BrowserPrinterProvider } from "./browser-printer";
import { BridgePrinterProvider } from "./providers/bridge-printer";

export * from "./printer-provider";

export function getPrinterProvider(name?: string): PrinterProvider {
  switch (name ?? process.env.PRINT_PROVIDER ?? "mock") {
    case "browser":
      return new BrowserPrinterProvider();
    case "bridge":
      return new BridgePrinterProvider();
    case "mock":
    default:
      return new MockPrinterProvider();
  }
}
