import { and, gte, lt, lte, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { businessDayBounds, type BusinessDateRange } from "@/lib/dates/dates";
import { toSafeInteger } from "@/lib/money/money";

/** `timestamptz` column within the range's Jakarta business days (half-open). */
export function withinBusinessDays(column: AnyColumn, range: BusinessDateRange): SQL {
  const { start, endExclusive } = businessDayBounds(range);
  return and(gte(column, start), lt(column, endExclusive))!;
}

/** Date-only column (no timezone) within the inclusive calendar range. */
export function withinCalendarDates(column: AnyColumn, range: BusinessDateRange): SQL {
  return and(gte(column, range.from), lte(column, range.to))!;
}

/**
 * SUM of integer Rupiah/quantity values as bigint (a sum of `integer`
 * columns can exceed 2^31), returned as a range-checked JS number.
 */
export function sumAsSafeInteger(expression: SQL | AnyColumn, filter?: SQL) {
  return filter
    ? sql`coalesce(sum(${expression}) filter (where ${filter}), 0)::bigint`.mapWith(toSafeInteger)
    : sql`coalesce(sum(${expression}), 0)::bigint`.mapWith(toSafeInteger);
}
