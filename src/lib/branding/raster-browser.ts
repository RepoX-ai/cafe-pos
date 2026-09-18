"use client";

import {
  MAX_LOGO_DOT_HEIGHT,
  PRINTER_DOT_WIDTH,
  bytesToBase64,
  packBits,
  type StoredLogoRaster,
} from "./raster";

/**
 * Turns an uploaded logo file into the 1-bit raster a thermal printer
 * takes, using the canvas the browser already has.
 *
 * Done here rather than on the server on purpose: it keeps every deploy
 * free of an image-decoding dependency (PRD rule 10 — this has to run the
 * same via `docker compose` or `next start` on a VPS), and it happens once
 * per logo upload rather than once per receipt.
 */

/** Alpha below this counts as paper, not ink. */
const OPAQUE_ENOUGH = 128;

/**
 * Floyd–Steinberg error diffusion. A café logo is usually flat colour, for
 * which a plain threshold is fine — but a photo or a gradient turns into
 * solid blocks under one, and dithering keeps it recognisable. The cost is
 * a single pass over at most 384x240 pixels.
 */
function dither(gray: Float32Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const old = gray[i];
      const black = old < 128;
      mask[i] = black ? 1 : 0;
      const error = old - (black ? 0 : 255);
      // Spread the rounding error into pixels not yet visited.
      if (x + 1 < width) gray[i + 1] += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (error * 3) / 16;
        gray[i + width] += (error * 5) / 16;
        if (x + 1 < width) gray[i + width + 1] += error / 16;
      }
    }
  }
  return mask;
}

export type RasterizeResult =
  | { ok: true; raster: StoredLogoRaster; previewDataUrl: string }
  | { ok: false; error: string };

/** Plenty for a logo at 2x on any screen it appears on. */
const MAX_DISPLAY_WIDTH = 800;

export type PreparedLogo = {
  /** Re-encoded, downscaled image to upload in place of the original. */
  file: File;
  raster: StoredLogoRaster | null;
  /** Null when the image could not be rasterised for the printer. */
  rasterError: string | null;
  previewDataUrl: string | null;
  displayUrl: string;
};

/**
 * Loads the file, fits it inside the paper width, converts to 1-bit and
 * returns both the packed bytes to store and a preview of exactly what
 * will print — so the owner sees the dithered result before saving, not a
 * surprise on the first receipt.
 */
export async function rasterizeLogoFile(file: File): Promise<RasterizeResult> {
  let bitmap: ImageBitmap | HTMLImageElement;
  let objectUrl: string | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
    } else {
      objectUrl = URL.createObjectURL(file);
      const url = objectUrl;
      bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("decode failed"));
        image.src = url;
      });
    }
  } catch {
    return { ok: false, error: "That image couldn't be read. Try a PNG, JPG or WebP." };
  }

  try {
    const sourceWidth = "width" in bitmap ? bitmap.width : 0;
    const sourceHeight = "height" in bitmap ? bitmap.height : 0;
    if (!sourceWidth || !sourceHeight) {
      return { ok: false, error: "That image appears to be empty." };
    }

    // Fit inside the paper, round the width down to a byte boundary, and
    // never upscale a small logo into a blurry one.
    const scale = Math.min(PRINTER_DOT_WIDTH / sourceWidth, MAX_LOGO_DOT_HEIGHT / sourceHeight, 1);
    const width = Math.max(8, Math.floor((sourceWidth * scale) / 8) * 8);
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { ok: false, error: "This browser can't prepare the receipt logo." };

    // White paper underneath, so transparent areas don't print as black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);

    const { data } = context.getImageData(0, 0, width, height);
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const alpha = data[i + 3];
      gray[p] =
        alpha < OPAQUE_ENOUGH
          ? 255 // treat as paper
          : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    const mask = dither(gray, width, height);
    if (!mask.some((bit) => bit === 1)) {
      return { ok: false, error: "That image is too light to print on receipt paper." };
    }

    // Preview: exactly the dithered pixels, so what they see is what prints.
    const preview = context.createImageData(width, height);
    for (let p = 0; p < mask.length; p += 1) {
      const value = mask[p] ? 0 : 255;
      preview.data[p * 4] = value;
      preview.data[p * 4 + 1] = value;
      preview.data[p * 4 + 2] = value;
      preview.data[p * 4 + 3] = 255;
    }
    context.putImageData(preview, 0, 0);

    return {
      ok: true,
      raster: { base64: bytesToBase64(packBits(mask, width, height)), width, height },
      previewDataUrl: canvas.toDataURL("image/png"),
    };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    image.src = url;
  });
}

/**
 * Prepares a chosen logo for upload: downscales and re-encodes it, and
 * produces the receipt raster from the same file.
 *
 * Downscaling is not a nicety. A photo straight off a phone is routinely
 * 4-8MB, which blows past the Server Action body limit before any
 * server-side size check can run — the browser just reports "Failed to
 * fetch". Re-encoding to at most 800px wide puts every realistic logo
 * comfortably inside the limit and keeps the VPS disk small.
 */
export async function prepareLogoUpload(file: File): Promise<{ ok: true; logo: PreparedLogo } | { ok: false; error: string }> {
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return { ok: false, error: "That image couldn't be read. Try a PNG, JPG or WebP." };
  }

  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  if (!sourceWidth || !sourceHeight) return { ok: false, error: "That image appears to be empty." };

  const scale = Math.min(MAX_DISPLAY_WIDTH / sourceWidth, 1);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return { ok: false, error: "This browser can't prepare the logo." };
  context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  // PNG keeps transparency, which a wordmark usually relies on.
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return { ok: false, error: "This browser can't prepare the logo." };

  const prepared = new File([blob], "logo.png", { type: "image/png" });
  const rasterResult = await rasterizeLogoFile(prepared);

  return {
    ok: true,
    logo: {
      file: prepared,
      raster: rasterResult.ok ? rasterResult.raster : null,
      rasterError: rasterResult.ok ? null : rasterResult.error,
      previewDataUrl: rasterResult.ok ? rasterResult.previewDataUrl : null,
      displayUrl: canvas.toDataURL("image/png"),
    },
  };
}
