/**
 * Minimal RFC 4180 CSV parser — pairs with csv.ts (the encoder). Handles
 * quoted fields containing commas, quotes (doubled), and embedded newlines,
 * and both CRLF and LF line endings. No header handling or type coercion;
 * that's the caller's job.
 */
export function parseCsv(text: string): string[][] {
  // Excel adds a UTF-8 BOM when saving CSV.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Final field/row when the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank lines (e.g. a trailing newline, or stray blank rows
  // left by a spreadsheet app on save).
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Rows as header-keyed records, using the first row as column names. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  const keys = header.map((key) => key.trim());
  return body.map((cells) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      record[key] = (cells[index] ?? "").trim();
    });
    return record;
  });
}
