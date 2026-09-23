import { afterEach, describe, expect, it } from "vitest";
import { configuredPrintProvider, getPrinterProvider, PrintProviderConfigError, resolvePrintProvider } from "@/printing";

const samplePayload = {
  orderId: "o1",
  orderNumber: "DEV-00001",
  locationName: "Main Store",
  createdAt: new Date().toISOString(),
  lines: [],
};

describe("printer providers", () => {
  it("mock provider always succeeds", async () => {
    const provider = getPrinterProvider("mock");
    await expect(provider.print(samplePayload)).resolves.toEqual({ success: true });
    await expect(provider.testConnection()).resolves.toMatchObject({ connected: true });
  });

  it("browser provider asks the client to print instead of confirming success itself", async () => {
    const provider = getPrinterProvider("browser");
    const result = await provider.print(samplePayload);
    expect(result.success).toBe(false);
    expect(result.requiresClientAction).toBe("window_print");
  });

  it("bridge provider reports as unconfigured rather than pretending to print", async () => {
    const provider = getPrinterProvider("bridge");
    await expect(provider.testConnection()).resolves.toMatchObject({ connected: false });
    const result = await provider.print(samplePayload);
    expect(result.success).toBe(false);
  });

  it("device provider hands the receipt to the tablet instead of claiming success", async () => {
    const provider = getPrinterProvider("device");
    const result = await provider.print(samplePayload);
    expect(result.success).toBe(false);
    expect(result.requiresClientAction).toBe("device_print");
  });

  it("device provider never reports a server-side connection", async () => {
    // The printer pairs with the tablet; the server genuinely cannot reach it.
    await expect(getPrinterProvider("device").testConnection()).resolves.toMatchObject({ connected: false });
  });

  it("defaults to mock when no provider is configured", () => {
    expect(getPrinterProvider(undefined).name).toBe("mock");
  });
});

describe("configured print provider", () => {
  const original = process.env.PRINT_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.PRINT_PROVIDER;
    else process.env.PRINT_PROVIDER = original;
  });

  it("uses the configured provider", () => {
    process.env.PRINT_PROVIDER = "device";
    expect(configuredPrintProvider()).toBe("device");
  });

  it("falls back to mock for an unknown value rather than writing it to the enum column", () => {
    process.env.PRINT_PROVIDER = "not-a-provider";
    expect(configuredPrintProvider()).toBe("mock");
  });

  it("falls back to mock when unset", () => {
    delete process.env.PRINT_PROVIDER;
    expect(configuredPrintProvider()).toBe("mock");
  });
});

describe("print provider in production", () => {
  const prod = (value?: string) => ({ NODE_ENV: "production", PRINT_PROVIDER: value });

  it("accepts the supported providers, including an explicit mock", () => {
    expect(resolvePrintProvider(prod("device"))).toBe("device");
    expect(resolvePrintProvider(prod("browser"))).toBe("browser");
    expect(resolvePrintProvider(prod("mock"))).toBe("mock");
  });

  it("refuses a missing or unknown provider instead of falling back to mock", () => {
    expect(() => resolvePrintProvider(prod(undefined))).toThrow(PrintProviderConfigError);
    expect(() => resolvePrintProvider(prod(""))).toThrow(PrintProviderConfigError);
    expect(() => resolvePrintProvider(prod("devcie"))).toThrow(PrintProviderConfigError);
  });

  it("refuses the unimplemented bridge adapter", () => {
    expect(() => resolvePrintProvider(prod("bridge"))).toThrow(/not implemented/);
  });
});
