/**
 * Shrinking and re-encoding an image in the browser, before it is ever
 * uploaded.
 *
 * Three reasons this happens client-side rather than on the server:
 *
 *  - A Server Action body is capped (4mb here). A photo straight off a
 *    phone is routinely past that, and Next rejects the request before any
 *    server code runs, so the browser only reports "Failed to fetch".
 *  - The server has no image decoder and must not grow one: this app has
 *    to run identically under `docker compose` or `next start` on a small
 *    VPS (PRD rule 10), and `sharp` is a native dependency.
 *  - The VPS disk is 60GB shared with the database and its backups. A
 *    café with 40 menu photos at 3MB each is 120MB of nothing; the same
 *    photos at 1200px WebP are a few megabytes.
 *
 * The pure geometry lives in `computeTargetSize` so it can be unit-tested
 * without a canvas.
 */

export interface PrepareImageOptions {
  /** Longest edge, in CSS pixels. Never upscales past the original. */
  maxWidth: number;
  maxHeight: number;
  /** WebP/JPEG quality, 0..1. Ignored by PNG. */
  quality?: number;
}

export interface PreparedImage {
  file: File;
  width: number;
  height: number;
  /** Bytes of the file the person chose. */
  originalBytes: number;
  /** Bytes actually uploaded — equal to originalBytes when we kept it. */
  bytes: number;
  /** Object URL for previewing; the caller revokes it. */
  previewUrl: string;
  /** False when re-encoding made it bigger and the original was kept. */
  recompressed: boolean;
}

/**
 * Fits `width`x`height` inside the box, preserving aspect ratio and never
 * scaling up — enlarging a small logo only makes it blurry and bigger.
 */
export function computeTargetSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Extension for whatever the canvas actually produced. */
export function extensionForType(type: string): string {
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  return "png";
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

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export type PrepareImageResult = { ok: true; image: PreparedImage } | { ok: false; error: string };

/**
 * Decodes, downscales and re-encodes to WebP.
 *
 * WebP is asked for by name and the result is checked, because a browser
 * that cannot encode it silently hands back a PNG instead of failing —
 * so the file is named after what actually came out, not what was asked
 * for. If re-encoding somehow produced a bigger file than the original
 * (an already-optimised WebP, say), the original is kept.
 */
export async function prepareImageUpload(
  file: File,
  options: PrepareImageOptions,
): Promise<PrepareImageResult> {
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return { ok: false, error: "That image couldn't be read. Try a PNG, JPG or WebP." };
  }

  const { width, height } = computeTargetSize(bitmap.width, bitmap.height, options.maxWidth, options.maxHeight);
  if (!width || !height) return { ok: false, error: "That image appears to be empty." };

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return { ok: false, error: "This browser can't process images." };
  context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const blob = await toBlob(canvas, "image/webp", options.quality ?? 0.82);
  if (!blob) return { ok: false, error: "This browser can't process images." };

  // Bigger than what we started with: keep the original bytes, but still
  // report the dimensions we would have used.
  const keepOriginal = blob.size >= file.size && bitmap.width === width && bitmap.height === height;
  const chosen = keepOriginal ? file : blob;
  const type = keepOriginal ? file.type : blob.type;

  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  const prepared = new File([chosen], `${base}.${extensionForType(type)}`, { type });

  return {
    ok: true,
    image: {
      file: prepared,
      width,
      height,
      originalBytes: file.size,
      bytes: prepared.size,
      previewUrl: URL.createObjectURL(prepared),
      recompressed: !keepOriginal,
    },
  };
}

/**
 * Replaces a file input's own FileList with the prepared file, so a plain
 * `<form action={...}>` submits the small version without the form itself
 * needing to know anything about this.
 */
export function setInputFile(input: HTMLInputElement, file: File): boolean {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    return true;
  } catch {
    return false;
  }
}

/** Human-readable size for the "3.4MB → 210KB" hint under the field. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
