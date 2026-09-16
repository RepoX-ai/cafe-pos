import { describe, expect, it } from "vitest";
import {
  averageRupiah,
  formatIDR,
  formatIDRRate,
  formatIDRRatePerPurchaseUnit,
  toSafeInteger,
} from "@/lib/money/money";
import { formatQuantityUnits, toQuantityUnits } from "@/lib/units/units";
import { pageHref, pageNumbers, pageWindow, parsePageParam, toPage, totalPageCount } from "@/lib/pagination";

describe("database aggregates", () => {
  it("keeps bigint sums above the 32-bit integer limit exact", () => {
    expect(toSafeInteger("4294967297")).toBe(4_294_967_297);
    expect(toSafeInteger("-2147483649")).toBe(-2_147_483_649);
    expect(toSafeInteger(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("refuses sums JavaScript can't represent exactly", () => {
    expect(() => toSafeInteger("9007199254740992")).toThrow(RangeError);
    expect(() => toSafeInteger("-9007199254740992")).toThrow(RangeError);
  });

  it("treats an empty aggregate as zero", () => {
    expect(toSafeInteger(null)).toBe(0);
    expect(toSafeInteger("0")).toBe(0);
  });

  it("averages whole Rupiah with half-up rounding and no float error", () => {
    expect(averageRupiah(5, 2)).toBe(3);
    expect(averageRupiah(4, 3)).toBe(1);
    expect(averageRupiah(4_000_000_001, 2)).toBe(2_000_000_001);
    expect(averageRupiah(100, 0)).toBe(0);
  });

  it("formats large totals and fractional cost rates", () => {
    expect(formatIDR(4_294_967_297)).toBe("Rp4.294.967.297");
    expect(formatIDRRate("12.5")).toBe("Rp12,5");
  });

  it("scales cost rates to the unit the ingredient is purchased in", () => {
    expect(formatIDRRatePerPurchaseUnit("913.56", "gram")).toBe("Rp913.560 / kg");
    expect(formatIDRRatePerPurchaseUnit("0.0165", "millilitre")).toBe("Rp16,5 / L");
    expect(formatIDRRatePerPurchaseUnit("500", "piece")).toBe("Rp500 / pc");
  });
});

describe("exact base-unit quantities", () => {
  it("rounds to numeric(16,4) half away from zero", () => {
    expect(toQuantityUnits("20.4")).toBe(204_000n);
    expect(toQuantityUnits(20.400000000000002)).toBe(204_000n);
    expect(toQuantityUnits("1.23455")).toBe(12_346n);
    expect(toQuantityUnits("-1.23455")).toBe(-12_346n);
  });

  it("sums without floating-point drift", () => {
    expect(formatQuantityUnits(toQuantityUnits(0.1) + toQuantityUnits(0.2))).toBe("0.3");
    expect(formatQuantityUnits(toQuantityUnits("940") + toQuantityUnits("60.0000"))).toBe("1000");
  });

  it("formats back to a Postgres numeric string", () => {
    expect(formatQuantityUnits(-12_346n)).toBe("-1.2346");
    expect(formatQuantityUnits(0n)).toBe("0");
    expect(formatQuantityUnits(5n)).toBe("0.0005");
  });

  it("rejects non-numeric input", () => {
    expect(() => toQuantityUnits("12abc")).toThrow();
    expect(() => toQuantityUnits(Number.NaN)).toThrow();
  });
});

describe("pagination params", () => {
  it("accepts only positive integer pages", () => {
    expect(parsePageParam("2")).toBe(2);
    expect(parsePageParam(["3"])).toBe(3);
    for (const bad of ["0", "-3", "abc", "1.5", undefined]) expect(parsePageParam(bad)).toBe(1);
  });

  it("fetches one extra row to detect a next page without counting", () => {
    expect(pageWindow(3, 20)).toEqual({ page: 3, pageSize: 20, limit: 21, offset: 40 });
    const page = toPage(Array.from({ length: 21 }, (_, i) => i), 3, 20);
    expect(page.rows).toHaveLength(20);
    expect(page.hasNextPage).toBe(true);
    expect(toPage([1, 2], 1, 20).hasNextPage).toBe(false);
  });

  it("lists page numbers with ellipses once there are more than seven pages", () => {
    expect(totalPageCount(0, 20)).toBe(1);
    expect(totalPageCount(1000, 20)).toBe(50);
    expect(pageNumbers(1, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pageNumbers(1, 50)).toEqual([1, 2, 3, 4, 5, "ellipsis", 50]);
    expect(pageNumbers(25, 50)).toEqual([1, "ellipsis", 24, 25, 26, "ellipsis", 50]);
    expect(pageNumbers(49, 50)).toEqual([1, "ellipsis", 46, 47, 48, 49, 50]);
  });

  it("keeps filters in page links and drops the page param for page one", () => {
    expect(pageHref("/orders", { status: "PRINTED", search: undefined, page: "4" }, 1)).toBe("/orders?status=PRINTED");
    expect(pageHref("/orders", { status: "PRINTED" }, 2)).toBe("/orders?status=PRINTED&page=2");
    expect(pageHref("/waste", {}, 1)).toBe("/waste");
  });
});
