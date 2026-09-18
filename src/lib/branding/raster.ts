/**
 * The business logo as a 1-bit image a thermal printer can accept.
 *
 * Rasterising happens **once, at upload time**, and the packed bytes are
 * stored on the business row. That keeps every print path free of an image
 * decoder: the server has no `sharp`, the Android tablet printing over
 * Bluetooth has no room for one, and a receipt must never depend on
 * fetching and decoding a PNG mid-sale. It also means the dithering is
 * done on a real canvas in the browser, where one already exists.
 *
 * This module holds the parts that need no DOM — packing and the ESC/POS
 * command — so they can be unit-tested without hardware or a browser. The
 * canvas half lives in `raster-browser.ts`.
 */

/** Rongta RPP02N: 58mm paper, 384 dots across. Also the hard ceiling. */
export const PRINTER_DOT_WIDTH = 384;

/** Taller than this wastes paper and slows every sale down. */
export const MAX_LOGO_DOT_HEIGHT = 240;

export interface LogoRaster {
  /** Multiple of 8, at most PRINTER_DOT_WIDTH. */
  width: number;
  height: number;
  /** Packed 1-bit rows, 8 pixels per byte, MSB leftmost. 1 = burn a dot. */
  data: Uint8Array;
}

export interface StoredLogoRaster {
  base64: string;
  width: number;
  height: number;
}

/**
 * Packs a one-byte-per-pixel mask (1 = dark) into ESC/POS bit rows.
 * `width` must be a multiple of 8 so rows are byte-aligned, which is what
 * the printer expects and what keeps the maths here trivial.
 */
export function packBits(mask: Uint8Array, width: number, height: number): Uint8Array {
  if (width % 8 !== 0) throw new Error(`Raster width must be a multiple of 8, got ${width}`);
  if (mask.length !== width * height) {
    throw new Error(`Mask is ${mask.length} bytes, expected ${width * height}`);
  }
  const bytesPerRow = width / 8;
  const out = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) {
        out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return out;
}

/** Base64 without relying on Buffer or atob being the one that exists here. */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    if (at < out.length) out[at++] = (n >> 16) & 0xff;
    if (at < out.length) out[at++] = (n >> 8) & 0xff;
    if (at < out.length) out[at++] = n & 0xff;
  }
  return out;
}

/**
 * `GS v 0` — print a raster bit image.
 *
 * Chosen over the older `ESC *` because it takes the whole image in one
 * command and does not need the caller to slice it into 8- or 24-dot
 * bands. Mode 0 is normal density, which is what 203dpi art is sized for.
 */
export function rasterImageCommand(raster: LogoRaster): number[] {
  const bytesPerRow = raster.width / 8;
  if (raster.data.length !== bytesPerRow * raster.height) {
    throw new Error(
      `Raster data is ${raster.data.length} bytes, expected ${bytesPerRow * raster.height} for ${raster.width}x${raster.height}`,
    );
  }
  if (raster.width > PRINTER_DOT_WIDTH) {
    throw new Error(`Raster is ${raster.width} dots wide, printer is ${PRINTER_DOT_WIDTH}`);
  }
  return [
    0x1d,
    0x76,
    0x30,
    0x00, // mode 0: normal
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    raster.height & 0xff,
    (raster.height >> 8) & 0xff,
    ...raster.data,
  ];
}

/** Rehydrates what `businesses.logo_raster_*` stores. Null if unusable. */
export function storedRasterToLogo(stored: {
  base64?: string | null;
  width?: number | null;
  height?: number | null;
}): LogoRaster | null {
  if (!stored.base64 || !stored.width || !stored.height) return null;
  if (stored.width % 8 !== 0 || stored.width > PRINTER_DOT_WIDTH) return null;
  const data = base64ToBytes(stored.base64);
  if (data.length !== (stored.width / 8) * stored.height) return null;
  return { width: stored.width, height: stored.height, data };
}
