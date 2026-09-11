/**
 * Minimal CSV encoder — no external dependency needed for the report
 * sizes a single café produces. Always quotes fields containing a comma,
 * quote, or newline, doubling embedded quotes per RFC 4180.
 */
export interface CsvColumn<T> {
  key: keyof T | string;
  label: string;
  value?: (row: T) => string | number | null | undefined;
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const raw = c.value ? c.value(row) : (row[c.key as keyof T] as unknown);
        return escapeCsvField(raw === null || raw === undefined ? "" : String(raw));
      })
      .join(","),
  );
  return [header, ...lines].join("\r\n");
}
