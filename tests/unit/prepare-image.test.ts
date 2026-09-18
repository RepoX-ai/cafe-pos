import { describe, expect, it } from "vitest";
import { computeTargetSize, extensionForType, formatBytes } from "@/lib/images/prepare-image";

describe("computeTargetSize", () => {
  it("fits inside the box, keeping aspect ratio", () => {
    // 4000x3000 photo into a 1200x1200 box -> width-bound.
    expect(computeTargetSize(4000, 3000, 1200, 1200)).toEqual({ width: 1200, height: 900 });
    // Tall image -> height-bound.
    expect(computeTargetSize(1000, 4000, 1200, 1200)).toEqual({ width: 300, height: 1200 });
  });

  it("never upscales — a small logo stays its own size", () => {
    expect(computeTargetSize(200, 80, 1200, 1200)).toEqual({ width: 200, height: 80 });
    expect(computeTargetSize(1, 1, 800, 800)).toEqual({ width: 1, height: 1 });
  });

  it("keeps at least one pixel on an extreme aspect ratio", () => {
    const { width, height } = computeTargetSize(10000, 5, 800, 800);
    expect(width).toBe(800);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("returns zero for a degenerate image rather than NaN", () => {
    expect(computeTargetSize(0, 0, 800, 800)).toEqual({ width: 0, height: 0 });
    expect(computeTargetSize(-5, 100, 800, 800)).toEqual({ width: 0, height: 0 });
  });
});

describe("extensionForType", () => {
  it("names the file after what the canvas actually produced", () => {
    expect(extensionForType("image/webp")).toBe("webp");
    expect(extensionForType("image/jpeg")).toBe("jpg");
    expect(extensionForType("image/png")).toBe("png");
    // A browser that can't encode WebP hands back a PNG; anything
    // unrecognised is treated the same way rather than trusted.
    expect(extensionForType("application/octet-stream")).toBe("png");
    expect(extensionForType("")).toBe("png");
  });
});

describe("formatBytes", () => {
  it("reads the way a size hint should", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(2048)).toBe("2KB");
    expect(formatBytes(210 * 1024)).toBe("210KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4MB");
  });
});
