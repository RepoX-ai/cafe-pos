import { describe, expect, it } from "vitest";
import {
  accentTokens,
  brandStyle,
  contrastRatio,
  contrastingForeground,
  meetsAaOnAccent,
  normalizeHexColor,
  relativeLuminance,
} from "@/lib/branding/branding";

describe("normalizeHexColor", () => {
  it("accepts the shapes an owner might paste, and canonicalises them", () => {
    expect(normalizeHexColor("#A5502B")).toBe("#a5502b");
    expect(normalizeHexColor("a5502b")).toBe("#a5502b");
    expect(normalizeHexColor("  #FFF  ")).toBe("#ffffff");
    expect(normalizeHexColor("#0a0")).toBe("#00aa00");
  });

  it("rejects anything else rather than producing a broken token", () => {
    for (const bad of ["", "   ", "red", "#12345", "#1234567", "rgb(1,2,3)", "#gggggg", null, undefined]) {
      expect(normalizeHexColor(bad), String(bad)).toBeNull();
    }
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("matches the WCAG reference points", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    // Black on white is the maximum possible ratio.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#a5502b", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#a5502b"), 10);
  });
});

describe("contrastingForeground", () => {
  it("puts white on dark accents and black on pale ones", () => {
    expect(contrastingForeground("#a5502b")).toBe("#ffffff"); // the app's own rust
    expect(contrastingForeground("#0b3d2e")).toBe("#ffffff"); // deep green restaurant
    expect(contrastingForeground("#f5d90a")).toBe("#08090a"); // yellow — white would be unreadable
    expect(contrastingForeground("#ffffff")).toBe("#08090a");
  });

  it("always picks the more readable of the two", () => {
    for (const hex of ["#000000", "#ffffff", "#a5502b", "#f5d90a", "#7f7f7f", "#123456"]) {
      const chosen = contrastingForeground(hex);
      const other = chosen === "#ffffff" ? "#08090a" : "#ffffff";
      expect(contrastRatio(hex, chosen), hex).toBeGreaterThanOrEqual(contrastRatio(hex, other));
    }
  });
});

describe("accentTokens", () => {
  it("derives a visibly different secondary and a readable contrast", () => {
    const tokens = accentTokens("#a5502b");
    expect(tokens.primary).toBe("#a5502b");
    expect(tokens.secondary).not.toBe(tokens.primary);
    expect(tokens.contrast).toBe("#ffffff");
    // Darker partner for a mid-tone accent.
    expect(relativeLuminance(tokens.secondary)).toBeLessThan(relativeLuminance(tokens.primary));
  });

  it("lightens the secondary when the accent is nearly black, so hover still shows", () => {
    for (const hex of ["#050505", "#0b3d2e"]) {
      const tokens = accentTokens(hex);
      expect(relativeLuminance(tokens.secondary), hex).toBeGreaterThan(relativeLuminance(tokens.primary));
    }
  });

  it("normalises its input and rejects nonsense", () => {
    expect(accentTokens("A5502B").primary).toBe("#a5502b");
    expect(() => accentTokens("not-a-colour")).toThrow("Not a hex colour");
  });
});

describe("brandStyle", () => {
  it("emits the custom properties the shell scopes a business with", () => {
    expect(brandStyle("#0b3d2e")).toMatchObject({
      "--color-accent-primary": "#0b3d2e",
      "--color-accent-contrast": "#ffffff",
    });
  });

  it("leaves the stylesheet alone when no colour is set or the value is junk", () => {
    expect(brandStyle(null)).toBeUndefined();
    expect(brandStyle("")).toBeUndefined();
    expect(brandStyle("chartreuse")).toBeUndefined();
  });
});

describe("meetsAaOnAccent", () => {
  it("flags accents that cannot carry body text either way", () => {
    expect(meetsAaOnAccent("#a5502b")).toBe(true);
    expect(meetsAaOnAccent("#0b3d2e")).toBe(true);
    expect(meetsAaOnAccent("#f5d90a")).toBe(true); // passes, on black
    // The band that fails against both black and white is genuinely narrow —
    // #777777 tops out at 4.48:1 either way.
    expect(meetsAaOnAccent("#777777")).toBe(false);
    expect(meetsAaOnAccent("nonsense")).toBe(false);
  });
});
