import { describe, expect, it } from "vitest";
import {
  businessDayBounds,
  calendarDaysInclusive,
  isCalendarDate,
  previousBusinessPeriod,
  resolveBusinessDateRange,
} from "@/lib/dates/dates";

describe("business date ranges (Asia/Jakarta)", () => {
  it("bounds a single business day as a half-open UTC range", () => {
    const { start, endExclusive } = businessDayBounds({ from: "2026-03-01", to: "2026-03-01" });
    expect(start.toISOString()).toBe("2026-02-28T17:00:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-03-01T17:00:00.000Z");
  });

  it("spans month and year boundaries", () => {
    const { start, endExclusive } = businessDayBounds({ from: "2025-12-31", to: "2026-01-01" });
    expect(start.toISOString()).toBe("2025-12-30T17:00:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });

  it("counts calendar days inclusively", () => {
    expect(calendarDaysInclusive({ from: "2026-03-01", to: "2026-03-01" })).toBe(1);
    expect(calendarDaysInclusive({ from: "2026-02-01", to: "2026-02-28" })).toBe(28);
    expect(calendarDaysInclusive({ from: "2024-02-01", to: "2024-02-29" })).toBe(29);
    expect(calendarDaysInclusive({ from: "2025-12-25", to: "2026-01-07" })).toBe(14);
  });

  it("compares a single day with the day immediately before it", () => {
    expect(previousBusinessPeriod({ from: "2026-03-01", to: "2026-03-01" })).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });

  it("compares a multi-day range with the equal-length period immediately before it", () => {
    expect(previousBusinessPeriod({ from: "2026-01-01", to: "2026-01-07" })).toEqual({ from: "2025-12-25", to: "2025-12-31" });
    expect(previousBusinessPeriod({ from: "2024-03-01", to: "2024-03-31" })).toEqual({ from: "2024-01-30", to: "2024-02-29" });
  });

  it("validates untrusted date params and orders a reversed range", () => {
    const defaults = { from: "2026-01-01", to: "2026-01-31" };
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-2-3")).toBe(false);
    expect(resolveBusinessDateRange("garbage", "2026-01-05", defaults)).toEqual({ from: "2026-01-01", to: "2026-01-05" });
    expect(resolveBusinessDateRange("2026-01-09", "2026-01-02", defaults)).toEqual({ from: "2026-01-02", to: "2026-01-09" });
    expect(resolveBusinessDateRange(undefined, null, defaults)).toEqual(defaults);
  });
});
