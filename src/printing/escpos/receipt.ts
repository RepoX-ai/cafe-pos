import { formatBusinessDateTime } from "@/lib/dates/dates";
import { formatIDR } from "@/lib/money/money";
import type { PrintJobPayload } from "../printer-provider";
import { rasterImageCommand, storedRasterToLogo } from "@/lib/branding/raster";
import {
  ALIGN_CENTER,
  ALIGN_LEFT,
  BOLD_OFF,
  BOLD_ON,
  encodeAscii,
  feed,
  INIT,
  LF,
  SELECT_CP437,
  SIZE_NORMAL,
  TALL_ON,
} from "./commands";

export type ReceiptDestination = "CUSTOMER_RECEIPT" | "KITCHEN_TICKET";

export type ReceiptOptions = {
  destination?: ReceiptDestination;
  /** 32 for 58mm paper in Font A. Only change for different hardware. */
  columns?: number;
  /** Blank lines fed at the end so the last line clears the tear bar. */
  feedLines?: number;
};

type Align = "left" | "center" | "right";

type Block =
  | { kind: "line"; text: string; align: Align; bold?: boolean; tall?: boolean }
  | { kind: "feed"; lines: number }
  | { kind: "raster"; data: number[] };

const DEFAULTS = { destination: "CUSTOMER_RECEIPT" as ReceiptDestination, columns: 32, feedLines: 4 };

/** Wraps on spaces, hard-splitting words longer than the paper is wide. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
    while (current.length > width) {
      lines.push(current.slice(0, width));
      current = current.slice(width);
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/**
 * Label on the left, amount flush right. If the label is too long to share
 * the line, it wraps and the amount takes the next line on its own — the
 * amount is never truncated or pushed past the paper edge.
 */
function row(label: string, amount: string, width: number): string[] {
  const wrapped = wrap(label, width);
  const last = wrapped[wrapped.length - 1];
  if (last.length + 1 + amount.length <= width) {
    wrapped[wrapped.length - 1] = last + " ".repeat(width - last.length - amount.length) + amount;
    return wrapped;
  }
  return [...wrapped, amount.padStart(width, " ")];
}

function itemLabel(line: PrintJobPayload["lines"][number]): string {
  const name = line.variantName ? `${line.name} - ${line.variantName}` : line.name;
  return `${line.quantity}x ${name}`;
}

function buildBlocks(payload: PrintJobPayload, options: ReceiptOptions = {}): Block[] {
  const { destination, columns, feedLines } = { ...DEFAULTS, ...options };
  const isKitchen = destination === "KITCHEN_TICKET";
  const divider = "-".repeat(columns);
  const blocks: Block[] = [];
  // `indent` is applied after wrapping — wrapping splits on whitespace, so
  // leading spaces baked into the text would be eaten.
  const push = (text: string, align: Align = "left", style: { bold?: boolean; tall?: boolean } = {}, indent = 0) => {
    for (const wrapped of wrap(text, columns - indent)) {
      blocks.push({ kind: "line", text: " ".repeat(indent) + wrapped, align, ...style });
    }
  };

  if (isKitchen) push("KITCHEN", "center", { bold: true, tall: true });
  else {
    // The logo replaces the name only when it actually rasterised; a
    // kitchen ticket never gets one, since it is thrown away in minutes
    // and the paper is better spent on the items.
    const logo = storedRasterToLogo(payload.logoRaster ?? {});
    if (logo) blocks.push({ kind: "raster", data: rasterImageCommand(logo) });
    else push(payload.locationName, "center", { bold: true, tall: true });
  }

  push(payload.orderNumber, "center", { bold: true, tall: isKitchen });
  push(formatBusinessDateTime(new Date(payload.createdAt), "dd MMM yyyy HH:mm"), "center");

  const context = [payload.orderType, payload.tableLabel].filter(Boolean).join(" - ");
  if (context) push(context, "center", { bold: isKitchen });
  push(divider);

  for (const line of payload.lines) {
    if (isKitchen) push(itemLabel(line), "left", { bold: true, tall: true });
    else if (line.lineTotal !== undefined) {
      for (const text of row(itemLabel(line), formatIDR(line.lineTotal), columns)) {
        blocks.push({ kind: "line", text, align: "left" });
      }
      // Unit price only matters when it isn't just the line total.
      if (line.quantity > 1 && line.unitPrice !== undefined) push(`@ ${formatIDR(line.unitPrice)}`, "left", {}, 2);
    } else push(itemLabel(line));

    if (line.modifiers.length) push(`+ ${line.modifiers.join(", ")}`, "left", {}, 2);
    if (line.note) push(`* ${line.note}`, "left", {}, 2);
  }

  if (!isKitchen) {
    push(divider);
    const totals: Array<[string, number | undefined]> = [
      ["Subtotal", payload.subtotal],
      ["Discount", payload.discount === undefined ? undefined : -payload.discount],
      ["Tax", payload.tax],
    ];
    for (const [label, value] of totals) {
      if (value === undefined) continue;
      for (const text of row(label, formatIDR(value), columns)) blocks.push({ kind: "line", text, align: "left" });
    }
    if (payload.total !== undefined) {
      for (const text of row("TOTAL", formatIDR(payload.total), columns)) {
        blocks.push({ kind: "line", text, align: "left", bold: true, tall: true });
      }
    }
    // Cash tendered and change, when the cashier recorded them. Printed
    // below the total so the customer can check the change against paper.
    const tender: Array<[string, number | undefined]> = [
      ["CASH", payload.cashReceived],
      ["CHANGE", payload.changeDue],
    ];
    for (const [label, value] of tender) {
      if (value === undefined) continue;
      for (const text of row(label, formatIDR(value), columns)) {
        blocks.push({ kind: "line", text, align: "left", bold: label === "CHANGE" });
      }
    }
    push(divider);
    if (payload.footer) push(payload.footer, "center");
  }

  blocks.push({ kind: "feed", lines: feedLines });
  return blocks;
}

/**
 * The receipt as plain text, laid out exactly as the printer will place it
 * — the on-screen preview and the unit tests both read this, so layout can
 * be verified without the hardware.
 */
export function renderReceiptText(payload: PrintJobPayload, options: ReceiptOptions = {}): string {
  const columns = options.columns ?? DEFAULTS.columns;
  return buildBlocks(payload, options)
    .flatMap((block) => {
      if (block.kind === "feed") return Array.from({ length: block.lines }, () => "");
      // The preview is text, so stand in for the image rather than
      // dropping the header line entirely.
      if (block.kind === "raster") return ["[logo]"];
      if (block.align === "center") {
        const pad = Math.max(0, Math.floor((columns - block.text.length) / 2));
        return [" ".repeat(pad) + block.text];
      }
      if (block.align === "right") return [block.text.padStart(columns, " ")];
      return [block.text];
    })
    .join("\n");
}

/** The same receipt as ESC/POS bytes, ready to write to the printer. */
export function renderReceipt(payload: PrintJobPayload, options: ReceiptOptions = {}): Uint8Array {
  const bytes: number[] = [...INIT, ...SELECT_CP437];
  let align: Align = "left";
  let bold = false;
  let tall = false;

  for (const block of buildBlocks(payload, options)) {
    if (block.kind === "feed") {
      bytes.push(...feed(block.lines));
      continue;
    }
    if (block.kind === "raster") {
      // Centre it, emit the image, then let the next block re-assert its
      // own alignment — the printer keeps whatever was set last.
      if (align !== "center") {
        bytes.push(...ALIGN_CENTER);
        align = "center";
      }
      bytes.push(...block.data, ...LF);
      continue;
    }
    if (block.align !== align) {
      bytes.push(...(block.align === "center" ? ALIGN_CENTER : ALIGN_LEFT));
      align = block.align;
    }
    if (Boolean(block.bold) !== bold) {
      bold = Boolean(block.bold);
      bytes.push(...(bold ? BOLD_ON : BOLD_OFF));
    }
    if (Boolean(block.tall) !== tall) {
      tall = Boolean(block.tall);
      bytes.push(...(tall ? TALL_ON : SIZE_NORMAL));
    }
    bytes.push(...encodeAscii(block.text), ...LF);
  }

  // Leave the printer in a known state for whatever prints next.
  bytes.push(...BOLD_OFF, ...SIZE_NORMAL, ...ALIGN_LEFT);
  return Uint8Array.from(bytes);
}
