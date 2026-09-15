import { describe, expect, it } from "vitest";
import { renderReceipt, renderReceiptText } from "@/printing/escpos/receipt";
import { toPrintableAscii } from "@/printing/escpos/commands";
import type { PrintJobPayload } from "@/printing/printer-provider";

const payload: PrintJobPayload = {
  orderId: "o1",
  orderNumber: "ORD-00042",
  locationName: "Matsudon",
  // 2026-09-15 14:33 Asia/Jakarta
  createdAt: "2026-09-15T07:33:00.000Z",
  orderType: "Dine-in",
  tableLabel: "Table 4",
  lines: [
    { name: "Nasi Goreng", variantName: "Large", quantity: 2, modifiers: ["Extra spicy", "No egg"], note: "less oil", unitPrice: 25000, lineTotal: 50000 },
    { name: "Es Teh", quantity: 1, modifiers: [], lineTotal: 8000 },
  ],
  subtotal: 58000,
  discount: 5000,
  tax: 5830,
  total: 58830,
  footer: "Terima kasih",
};

const lines = (text: string) => text.split("\n");

describe("ESC/POS receipt layout", () => {
  it("never exceeds the 32-column paper width", () => {
    for (const line of lines(renderReceiptText(payload))) expect(line.length).toBeLessThanOrEqual(32);
  });

  it("prints amounts flush to the right edge", () => {
    const total = lines(renderReceiptText(payload)).find((line) => line.startsWith("TOTAL"));
    expect(total).toBe("TOTAL" + "Rp58.830".padStart(27, " "));
    expect(total).toHaveLength(32);
  });

  it("shows a discount as a negative amount", () => {
    expect(renderReceiptText(payload)).toContain("-Rp5.000");
  });

  it("shows the unit price only when more than one was ordered", () => {
    const text = renderReceiptText(payload);
    expect(text).toContain("2x Nasi Goreng - Large");
    expect(text).toContain("@ Rp25.000");
    expect(text).not.toContain("@ Rp8.000");
  });

  it("keeps the amount on its own line when the item name fills the width", () => {
    const long: PrintJobPayload = {
      ...payload,
      // An unbroken 32-character name leaves no room to share the line.
      lines: [{ name: "Rendang-Sapi-Spesial-Pedas-Manis", quantity: 1, modifiers: [], lineTotal: 32000 }],
    };
    const text = lines(renderReceiptText(long));
    for (const line of text) expect(line.length).toBeLessThanOrEqual(32);
    expect(text).toContain("Rp32.000".padStart(32, " "));
  });

  it("prints times in Asia/Jakarta, not UTC", () => {
    expect(renderReceiptText(payload)).toContain("15 Sep 2026 14:33");
  });

  it("omits prices and totals from a kitchen ticket", () => {
    const text = renderReceiptText(payload, { destination: "KITCHEN_TICKET" });
    expect(text).toContain("KITCHEN");
    expect(text).toContain("2x Nasi Goreng - Large");
    expect(text).toContain("+ Extra spicy, No egg");
    expect(text).toContain("* less oil");
    expect(text).not.toContain("Rp");
    expect(text).not.toContain("TOTAL");
  });

  it("ends with blank lines so the last line clears the tear bar", () => {
    const printed = lines(renderReceiptText(payload));
    expect(printed.slice(-4).every((line) => line === "")).toBe(true);
  });
});

describe("ESC/POS byte output", () => {
  it("starts by resetting the printer and selecting CP437", () => {
    expect(Array.from(renderReceipt(payload).slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x00]);
  });

  it("ends by feeding paper and restoring normal styling", () => {
    const bytes = Array.from(renderReceipt(payload));
    // ESC d 4 (feed), then bold off, normal size, align left.
    expect(bytes.slice(-9)).toEqual([0x1b, 0x64, 0x04, 0x1b, 0x45, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x61, 0x00].slice(-9));
  });

  it("never emits a cut command — this printer has a tear bar, not a cutter", () => {
    const bytes = Array.from(renderReceipt(payload));
    for (let i = 0; i < bytes.length - 1; i += 1) {
      // GS V (cut) in any of its variants.
      expect(bytes[i] === 0x1d && bytes[i + 1] === 0x56).toBe(false);
    }
  });

  it("emits only bytes the printer can render", () => {
    const accented: PrintJobPayload = {
      ...payload,
      lines: [{ name: "Café Crème 日本", quantity: 1, modifiers: [], lineTotal: 1000 }],
    };
    const bytes = renderReceipt(accented);
    for (const byte of bytes) expect(byte).toBeLessThanOrEqual(0x7f);
    expect(toPrintableAscii("Café Crème 日本")).toBe("Cafe Creme ??");
  });
});
