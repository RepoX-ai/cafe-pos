import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Keyset ("seek") pagination for newest-first lists ordered by
 * `(timestamp desc, id desc)`. Unlike OFFSET, fetching the next batch costs
 * the same however deep into the list it is.
 *
 * The cursor carries the timestamp as PostgreSQL's own text rendering, not a
 * JS Date: `timestamptz` has microsecond precision and Date only
 * milliseconds, so a Date cursor would silently skip rows that share the
 * last row's millisecond.
 */
export interface TimeCursor {
  ts: string;
  id: string;
}

/** Selected alongside each row so the caller can build the next cursor. */
export function cursorText(column: AnyColumn): SQL<string> {
  return sql<string>`${column}::text`;
}

/** Rows strictly after `cursor` in `(ts desc, id desc)` order. */
export function afterTimeCursor(tsColumn: AnyColumn, idColumn: AnyColumn, cursor: TimeCursor): SQL {
  return sql`(${tsColumn}, ${idColumn}) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`;
}

/** Expenses: `(expense_date desc, created_at desc, id desc)`. */
export interface DatedCursor extends TimeCursor {
  date: string;
}

export function afterDatedCursor(dateColumn: AnyColumn, tsColumn: AnyColumn, idColumn: AnyColumn, cursor: DatedCursor): SQL {
  return sql`(${dateColumn}, ${tsColumn}, ${idColumn}) < (${cursor.date}::date, ${cursor.ts}::timestamptz, ${cursor.id}::uuid)`;
}
