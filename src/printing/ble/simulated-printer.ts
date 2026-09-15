import type { PrinterLink } from "./web-bluetooth";

/**
 * A fake printer for developing without the hardware (which lives in the
 * café). It accepts the same ESC/POS bytes over the same PrinterLink
 * interface, so checkout, job status and reporting all run exactly as they
 * would against the real RPP02N — only the Bluetooth radio is missing.
 *
 * It cannot tell you whether the real printer's firmware will accept the
 * bytes: chunking, sleep and characteristic quirks still need the device.
 * It does tell you the receipt is correct and the POS wiring works.
 */

/**
 * Turns the ESC/POS byte stream back into the text the paper would show,
 * including alignment — the printer centres lines itself in response to
 * ESC a, so a decoder that ignored it would misrepresent the layout.
 */
export function decodeEscPos(bytes: Uint8Array, columns = 32): string {
  const lines: string[] = [];
  let line = "";
  let align: "left" | "center" | "right" = "left";

  const flush = () => {
    // A blank line is blank — never pad it out to the middle of the paper.
    if (!line) lines.push("");
    else if (align === "center") lines.push(" ".repeat(Math.max(0, Math.floor((columns - line.length) / 2))) + line);
    else if (align === "right") lines.push(line.padStart(columns, " "));
    else lines.push(line);
    line = "";
  };

  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === 0x1b) {
      const command = bytes[i + 1];
      if (command === 0x64) {
        // ESC d n — feed n lines.
        flush();
        for (let blank = 1; blank < (bytes[i + 2] ?? 0); blank += 1) lines.push("");
        i += 2;
        continue;
      }
      if (command === 0x61) {
        // ESC a n — alignment, applying from the next line onwards.
        const value = bytes[i + 2];
        align = value === 1 ? "center" : value === 2 ? "right" : "left";
        i += 2;
        continue;
      }
      // ESC @ takes no argument; ESC E / ESC t each take one.
      i += command === 0x40 ? 1 : 2;
      continue;
    }
    if (byte === 0x1d) {
      i += 2; // GS ! n — text size.
      continue;
    }
    if (byte === 0x0a) {
      flush();
      continue;
    }
    if (byte >= 0x20 && byte <= 0x7e) line += String.fromCharCode(byte);
  }
  if (line) flush();
  return lines.join("\n");
}

export type SimulatedPrinter = PrinterLink & {
  /** Everything "printed" so far, newest last. */
  history(): string[];
};

export function createSimulatedPrinter(onPrint?: (receipt: string) => void): SimulatedPrinter {
  const printed: string[] = [];
  const device = {
    id: "simulated",
    name: "Simulated printer",
    addEventListener: () => {},
  };

  return {
    device,
    serviceUuid: "simulated",
    characteristicUuid: "simulated",
    endpoints: [],
    mode: "with-response",
    isConnected: () => true,
    async write(bytes, options = {}) {
      // Walk the same chunk loop so progress reporting behaves the same.
      const chunkSize = options.chunkSize ?? 20;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        options.onProgress?.(Math.min(offset + chunkSize, bytes.length), bytes.length);
      }
      const receipt = decodeEscPos(bytes);
      printed.push(receipt);
      onPrint?.(receipt);
    },
    async onNotify() {
      return false;
    },
    disconnect() {},
    history: () => [...printed],
  };
}
