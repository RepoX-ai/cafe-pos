import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  packBits,
  PRINTER_DOT_WIDTH,
  rasterImageCommand,
  storedRasterToLogo,
  type LogoRaster,
} from "@/lib/branding/raster";

describe("packBits", () => {
  it("packs 8 pixels per byte, most significant bit leftmost", () => {
    // 1000 0001 -> 0x81
    const mask = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(packBits(mask, 8, 1))).toEqual([0x81]);
  });

  it("keeps rows byte-aligned", () => {
    const mask = new Uint8Array(16 * 2);
    mask[0] = 1; // first pixel of row 0
    mask[16] = 1; // first pixel of row 1
    const packed = packBits(mask, 16, 2);
    expect(packed.length).toBe(4); // 2 bytes per row, 2 rows
    expect(Array.from(packed)).toEqual([0x80, 0x00, 0x80, 0x00]);
  });

  it("refuses a width the printer could not address", () => {
    expect(() => packBits(new Uint8Array(12), 12, 1)).toThrow("multiple of 8");
  });

  it("refuses a mask that does not match the stated size", () => {
    expect(() => packBits(new Uint8Array(7), 8, 1)).toThrow("expected 8");
  });
});

describe("base64 round trip", () => {
  it("survives every byte value and every length remainder", () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 256, 257]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (i * 7) % 256;
      expect(Array.from(base64ToBytes(bytesToBase64(bytes))), `length ${length}`).toEqual(Array.from(bytes));
    }
  });

  it("agrees with Buffer, so what we store is real base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("rasterImageCommand", () => {
  const raster: LogoRaster = { width: 16, height: 2, data: new Uint8Array([0x80, 0x01, 0xff, 0x00]) };

  it("emits GS v 0 with little-endian width in bytes and height in dots", () => {
    const bytes = rasterImageCommand(raster);
    expect(bytes.slice(0, 4)).toEqual([0x1d, 0x76, 0x30, 0x00]);
    expect(bytes.slice(4, 6)).toEqual([2, 0]); // 16 dots = 2 bytes per row
    expect(bytes.slice(6, 8)).toEqual([2, 0]); // 2 rows
    expect(bytes.slice(8)).toEqual([0x80, 0x01, 0xff, 0x00]);
  });

  it("encodes a tall image's height across both bytes", () => {
    const tall: LogoRaster = { width: 8, height: 300, data: new Uint8Array(300) };
    const bytes = rasterImageCommand(tall);
    expect(bytes.slice(6, 8)).toEqual([300 & 0xff, 300 >> 8]);
  });

  it("refuses data that does not match the declared size", () => {
    expect(() => rasterImageCommand({ width: 16, height: 2, data: new Uint8Array(3) })).toThrow("expected 4");
  });

  it("refuses an image wider than the paper", () => {
    const tooWide = PRINTER_DOT_WIDTH + 8;
    expect(() =>
      rasterImageCommand({ width: tooWide, height: 1, data: new Uint8Array(tooWide / 8) }),
    ).toThrow("printer is 384");
  });
});

describe("storedRasterToLogo", () => {
  it("rehydrates what the business row stores", () => {
    const data = new Uint8Array([0xaa, 0x55, 0x0f, 0xf0]);
    const logo = storedRasterToLogo({ base64: bytesToBase64(data), width: 16, height: 2 });
    expect(logo).not.toBeNull();
    expect(Array.from(logo!.data)).toEqual(Array.from(data));
  });

  it("returns null rather than a corrupt image for anything inconsistent", () => {
    const data = bytesToBase64(new Uint8Array([0xaa, 0x55, 0x0f, 0xf0]));
    expect(storedRasterToLogo({ base64: null, width: 16, height: 2 })).toBeNull();
    expect(storedRasterToLogo({ base64: data, width: null, height: 2 })).toBeNull();
    expect(storedRasterToLogo({ base64: data, width: 12, height: 2 })).toBeNull(); // not byte-aligned
    expect(storedRasterToLogo({ base64: data, width: 16, height: 99 })).toBeNull(); // length mismatch
    expect(storedRasterToLogo({ base64: data, width: 4096, height: 1 })).toBeNull(); // wider than paper
  });
});
