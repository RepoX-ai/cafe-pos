import type { PrinterProvider, PrintProviderName } from "./printer-provider";
import { MockPrinterProvider } from "./mock-printer";
import { BrowserPrinterProvider } from "./browser-printer";
import { BridgePrinterProvider } from "./providers/bridge-printer";
import { DevicePrinterProvider } from "./providers/device-printer";

export * from "./printer-provider";

const PROVIDER_NAMES: PrintProviderName[] = ["mock", "browser", "bridge", "device"];

/**
 * Providers a production install may be configured with. `bridge` is a
 * placeholder with no protocol behind it (see providers/bridge-printer.ts),
 * so it is refused until it is implemented; `mock` is allowed only when
 * chosen explicitly (e.g. a staging install without hardware).
 */
const PRODUCTION_PROVIDERS: PrintProviderName[] = ["device", "browser", "mock"];

export class PrintProviderConfigError extends Error {}

/**
 * Resolves PRINT_PROVIDER. In production a missing, unknown or unsupported
 * value is an error — never a silent fallback to the mock printer, which
 * would report receipts as printed that never were. Outside production an
 * unknown value still falls back to mock for local work.
 */
export function resolvePrintProvider(env: Record<string, string | undefined> = process.env): PrintProviderName {
  const configured = env.PRINT_PROVIDER?.trim() as PrintProviderName | undefined;
  if (env.NODE_ENV === "production") {
    if (!configured) throw new PrintProviderConfigError("PRINT_PROVIDER must be set in production (device, browser or mock).");
    if (configured === "bridge") {
      throw new PrintProviderConfigError("PRINT_PROVIDER=bridge is not supported: the hardware bridge adapter is not implemented. Use device or browser.");
    }
    if (!PRODUCTION_PROVIDERS.includes(configured)) {
      throw new PrintProviderConfigError(`PRINT_PROVIDER "${configured}" is not a known provider (device, browser or mock).`);
    }
    return configured;
  }
  return configured && PROVIDER_NAMES.includes(configured) ? configured : "mock";
}

/** The provider new print jobs are created with — the single place PRINT_PROVIDER is read. */
export function configuredPrintProvider(): PrintProviderName {
  return resolvePrintProvider(process.env);
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
