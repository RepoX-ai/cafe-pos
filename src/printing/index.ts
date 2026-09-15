import type { PrinterProvider, PrintProviderName } from "./printer-provider";
import { MockPrinterProvider } from "./mock-printer";
import { BrowserPrinterProvider } from "./browser-printer";
import { BridgePrinterProvider } from "./providers/bridge-printer";
import { DevicePrinterProvider } from "./providers/device-printer";

export * from "./printer-provider";

const PROVIDER_NAMES: PrintProviderName[] = ["mock", "browser", "bridge", "device"];

/**
 * The provider new print jobs are created with. Single source of truth for
 * reading PRINT_PROVIDER, so an unknown value falls back to mock in one
 * place instead of being cast blindly at each insert site.
 */
export function configuredPrintProvider(): PrintProviderName {
  const configured = process.env.PRINT_PROVIDER as PrintProviderName | undefined;
  return configured && PROVIDER_NAMES.includes(configured) ? configured : "mock";
}

export function getPrinterProvider(name?: string): PrinterProvider {
  switch (name ?? configuredPrintProvider()) {
    case "browser":
      return new BrowserPrinterProvider();
    case "bridge":
      return new BridgePrinterProvider();
    case "device":
      return new DevicePrinterProvider();
    case "mock":
    default:
      return new MockPrinterProvider();
  }
}
