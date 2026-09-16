/**
 * Low-level ESC/POS byte sequences.
 *
 * Target hardware is the café's iWare-branded Rongta RPP02N: 58mm paper,
 * 48mm/384-dot print width (32 columns in Font A), 203 dpi, tear bar and
 * **no cutter** — so receipts end with a paper feed, never a cut command.
 *
 * Kept free of DOM/Node APIs so the same module renders bytes on the
 * server and in the browser, and can be unit-tested without hardware.
 */

const ESC = 0x1b;
const GS = 0x1d;

export const INIT = [ESC, 0x40];
/** CP437 is the RPP02N's default page; text is ASCII-folded before encoding. */
export const SELECT_CP437 = [ESC, 0x74, 0x00];
export const ALIGN_LEFT = [ESC, 0x61, 0x00];
export const ALIGN_CENTER = [ESC, 0x61, 0x01];
export const BOLD_ON = [ESC, 0x45, 0x01];
export const BOLD_OFF = [ESC, 0x45, 0x00];
/**
 * Double *height* only. Double width would halve the 32-column grid the
 * layout is built on, so amounts would stop lining up.
 */
export const TALL_ON = [GS, 0x21, 0x01];
export const SIZE_NORMAL = [GS, 0x21, 0x00];
export const LF = [0x0a];

/** Feed n blank lines — how a cutter-less printer clears the tear bar. */
export function feed(lines: number): number[] {
  return [ESC, 0x64, Math.max(0, Math.min(255, Math.trunc(lines)))];
}

/**
 * Folds text into printable ASCII. The printer's CP437 page has no
 * Indonesian or accented characters beyond ASCII, and sending raw UTF-8
 * prints mojibake rather than failing, so strip diacritics first and
 * replace anything still unprintable.
 */
export function toPrintableAscii(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7e]/g, "?");
}

export function encodeAscii(text: string): number[] {
  const folded = toPrintableAscii(text);
  const bytes: number[] = [];
  for (let i = 0; i < folded.length; i += 1) bytes.push(folded.charCodeAt(i));
  return bytes;
}
