import { describe, expect, it } from "vitest";
import { calculateOrderTotals, calculateServiceCharge, calculateTax, orderTaxIsIncluded } from "@/lib/settings/tax";

describe("tax and service charge", () => {
  it("does not charge included tax twice and excludes it from net sales", () => {
    expect(calculateOrderTotals(111_000, 0, { percent: 11, inclusive: true }, null)).toEqual({
      discountTotal: 0, netSales: 100_000, taxTotal: 11_000, serviceChargeTotal: 0, total: 111_000,
    });
  });

  it("applies discounts before included tax and service on discounted menu prices", () => {
    expect(calculateOrderTotals(222_000, 111_000, { percent: 11, inclusive: true }, 10)).toEqual({
      discountTotal: 111_000, netSales: 100_000, taxTotal: 11_000, serviceChargeTotal: 11_100, total: 122_100,
    });
  });

  it("preserves exclusive-tax pricing", () => {
    expect(calculateOrderTotals(110_000, 10_000, { percent: 11, inclusive: false }, 5)).toEqual({
      discountTotal: 10_000, netSales: 100_000, taxTotal: 11_000, serviceChargeTotal: 5_000, total: 116_000,
    });
  });

  it("caps a full discount at the subtotal", () => {
    expect(calculateOrderTotals(100, 200, { percent: 11, inclusive: true }, 10)).toEqual({
      discountTotal: 100, netSales: 0, taxTotal: 0, serviceChargeTotal: 0, total: 0,
    });
  });

  it("labels historical tax from the amounts actually charged", () => {
    const order = { subtotal: 111_000, discountTotal: 0, taxTotal: 11_000, serviceChargeTotal: 0, total: 111_000 };
    expect(orderTaxIsIncluded(order)).toBe(true);
    expect(orderTaxIsIncluded({ ...order, total: 122_000 })).toBe(false);
    expect(orderTaxIsIncluded({ ...order, taxTotal: 0 })).toBe(false);
  });

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
