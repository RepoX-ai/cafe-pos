import { describe, expect, it } from "vitest";
import {
  CASH_TENDER_LABELS,
  CASH_TENDER_MODES,
  cashTenderPreset,
  resolveCashReceived,
} from "@/app/pos/pos-order-options";

describe("cash tender shortcuts", () => {
  it("treats no selection as nothing tendered, which is what blocks submission", () => {
    expect(resolveCashReceived(null, null, 38_000)).toBeNull();
  });

  it("tracks the running total for 'Uang pas' instead of freezing an amount", () => {
    expect(resolveCashReceived("exact", null, 38_000)).toBe(38_000);
    // The cart grew after the cashier tapped it; the tender follows.
    expect(resolveCashReceived("exact", null, 52_000)).toBe(52_000);
  });

  it("tenders the note's face value for a preset, whatever the total", () => {
    expect(resolveCashReceived("50000", null, 38_000)).toBe(50_000);
    expect(resolveCashReceived("100000", null, 38_000)).toBe(100_000);
  });

  it("uses the typed amount for 'Lainnya', and stays null until one is typed", () => {
    expect(resolveCashReceived("custom", null, 38_000)).toBeNull();
    expect(resolveCashReceived("custom", 75_000, 38_000)).toBe(75_000);
  });

  it("ignores a stale custom amount once a preset is picked", () => {
    expect(resolveCashReceived("50000", 75_000, 38_000)).toBe(50_000);
    expect(resolveCashReceived("exact", 75_000, 38_000)).toBe(38_000);
  });

  it("reports a fixed face value only for the presets", () => {
    expect(cashTenderPreset("50000")).toBe(50_000);
    expect(cashTenderPreset("100000")).toBe(100_000);
    // These depend on the cart or the cashier, so they have no fixed value
    // and must never be disabled as "too small to cover the total".
    expect(cashTenderPreset("exact")).toBeNull();
    expect(cashTenderPreset("custom")).toBeNull();
  });

  it("labels every mode", () => {
    for (const mode of CASH_TENDER_MODES) expect(CASH_TENDER_LABELS[mode]).toBeTruthy();
  });
});
