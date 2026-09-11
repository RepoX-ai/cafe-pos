import { describe, expect, it } from "vitest";
import { getPrinterProvider } from "@/printing";

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

  it("defaults to mock when no provider is configured", () => {
    expect(getPrinterProvider(undefined).name).toBe("mock");
  });
});
