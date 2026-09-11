import { describe, expect, it } from "vitest";
import {
  applyPercentage,
  formatIDR,
  grossMarginPercentage,
  microsToRupiah,
  multiplyQuantityByRate,
  rupiahToMicros,
  sumRupiah,
} from "@/lib/money/money";

describe("money", () => {
  it("round-trips whole Rupiah through micros", () => {
    expect(microsToRupiah(rupiahToMicros(25_000))).toBe(25_000);
    expect(microsToRupiah(rupiahToMicros(0))).toBe(0);
  });

  it("rounds half up to the nearest whole Rupiah", () => {
    expect(microsToRupiah(1_500_000n)).toBe(2); // 1.5 -> 2
    expect(microsToRupiah(1_499_999n)).toBe(1); // 1.499999 -> 1
    expect(microsToRupiah(-1_500_000n)).toBe(-2);
  });

  it("multiplies a recipe quantity by a decimal cost rate exactly", () => {
    // 18g of coffee beans at Rp0.25/gram = Rp4.5 -> rounds to Rp5 (half up)
    const micros = multiplyQuantityByRate("18", "0.25");
    expect(microsToRupiah(micros)).toBe(5);
  });

  it("multiplies large quantities without float drift", () => {
    // 150ml milk at Rp0.02/ml = Rp3 exactly
    const micros = multiplyQuantityByRate("150", "0.02");
    expect(microsToRupiah(micros)).toBe(3);
  });

  it("applies a percentage discount/tax and rounds to whole Rupiah", () => {
    expect(applyPercentage(25_000, 10)).toBe(2_500);
    expect(applyPercentage(33_000, 11)).toBe(3_630);
  });

  it("sums a list of Rupiah amounts", () => {
    expect(sumRupiah([25_000, 30_000, 15_000])).toBe(70_000);
  });

  it("formats IDR without a space between symbol and amount", () => {
    expect(formatIDR(25_000)).toBe("Rp25.000");
  });

  it("returns null gross margin when net sales is zero", () => {
    expect(grossMarginPercentage(0, 0)).toBeNull();
  });

  it("computes gross margin percentage", () => {
    // profit 10000 on sales 25000 = 40%
    expect(grossMarginPercentage(10_000, 25_000)).toBe(40);
  });
});
