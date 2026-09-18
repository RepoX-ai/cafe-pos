/**
 * Per-business theming.
 *
 * A business stores one accent colour. Everything else the UI needs — the
 * darker secondary, and the text colour that sits on top of the accent —
 * is derived from it here rather than stored, so the three can never drift
 * apart, and so an owner only ever has to make one decision.
 *
 * Framework-agnostic and dependency-free: unit-tested in
 * `tests/unit/branding.test.ts`, and safe to call from a Server Component
 * or the browser.
 */

export interface AccentTokens {
  /** `--color-accent-primary` */
  primary: string;
  /** `--color-accent-secondary` — hover/pressed and the gradient partner. */
  secondary: string;
  /** `--color-accent-contrast` — text/icons drawn on top of `primary`. */
  contrast: string;
}

/** The two foregrounds the design system already uses on solid colour. */
const LIGHT_FOREGROUND = "#ffffff";
const DARK_FOREGROUND = "#08090a";

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Accepts `#rgb`, `#rrggbb` or the same without the hash, in any case, and
 * returns a canonical lowercase `#rrggbb`. Returns null for anything else —
 * callers treat null as "no brand colour set" and fall back to the app
 * default, so a bad value can never produce a broken stylesheet.
 */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = HEX.exec(input.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return `#${full}`;
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance (sRGB, gamma-expanded). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Black or white, whichever is more readable on `hex`. An owner picking a
 * pale yellow gets black text rather than the unreadable white the fixed
 * token would have given them.
 */
export function contrastingForeground(hex: string): string {
  return contrastRatio(hex, LIGHT_FOREGROUND) >= contrastRatio(hex, DARK_FOREGROUND)
    ? LIGHT_FOREGROUND
    : DARK_FOREGROUND;
}

/** Mixes toward black (`amount` < 0) or white (> 0) by a 0..1 fraction. */
function shift(hex: string, amount: number): string {
  const [r, g, b] = channels(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex(r + (target - r) * t, g + (target - g) * t, b + (target - b) * t);
}

/**
 * Luminance below which darkening the accent would produce a hover state
 * nobody can see, so we lighten instead. Deliberately low: the app's own
 * rust (#a5502b) sits at 0.14 and must still darken like any mid-tone.
 */
const NEAR_BLACK_LUMINANCE = 0.06;

/**
 * The full accent set for one brand colour.
 *
 * The secondary is normally a darker partner for hover and pressed states.
 * For a near-black accent that would be invisible, so it lightens instead.
 */
export function accentTokens(brandColor: string): AccentTokens {
  const primary = normalizeHexColor(brandColor);
  if (!primary) throw new Error(`Not a hex colour: ${brandColor}`);
  const luminance = relativeLuminance(primary);
  return {
    primary,
    secondary: shift(primary, luminance < NEAR_BLACK_LUMINANCE ? 0.22 : -0.22),
    contrast: contrastingForeground(primary),
  };
}

/**
 * Inline `style` for the element that scopes a business's theme, as React
 * expects custom properties. Returns undefined when the business has no
 * brand colour, leaving the stylesheet's own tokens in place.
 */
export function brandStyle(brandColor: string | null | undefined): React.CSSProperties | undefined {
  const normalized = normalizeHexColor(brandColor);
  if (!normalized) return undefined;
  const tokens = accentTokens(normalized);
  return {
    "--color-accent-primary": tokens.primary,
    "--color-accent-secondary": tokens.secondary,
    "--color-accent-contrast": tokens.contrast,
    "--color-accent": tokens.primary,
  } as React.CSSProperties;
}

/**
 * Whether text on this accent clears WCAG AA for normal body text. The
 * settings form warns on false rather than refusing — an accent is mostly
 * used behind large text and icons, where 3:1 is the real bar, and it is
 * the owner's brand.
 */
export function meetsAaOnAccent(brandColor: string): boolean {
  const normalized = normalizeHexColor(brandColor);
  if (!normalized) return false;
  return contrastRatio(normalized, contrastingForeground(normalized)) >= 4.5;
}
