import { describe, expect, it } from "vitest";
import { calculateServiceCharge, calculateTax } from "@/lib/settings/tax";

describe("tax and service charge", () => {
  it("returns zero when unconfigured", () => {
    expect(calculateTax(100_000, null)).toBe(0);
    expect(calculateServiceCharge(100_000, null)).toBe(0);
  });

  it("adds exclusive tax on top", () => {
    expect(calculateTax(100_000, { percent: 11, inclusive: false })).toBe(11_000);
  });

  it("backs inclusive tax out of the subtotal instead of adding it", () => {
    // 111,000 inclusive of 11% tax -> base 100,000, tax 11,000
    expect(calculateTax(111_000, { percent: 11, inclusive: true })).toBe(11_000);
  });

  it("computes a service charge percentage", () => {
    expect(calculateServiceCharge(100_000, 5)).toBe(5_000);
  });
});
