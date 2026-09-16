import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * All timestamps are stored in UTC (Postgres `timestamptz`). This module is
 * the single place that converts to/from the business display timezone
 * (Asia/Jakarta, WIB, UTC+7 — no DST) for anything shown to staff or
 * exported in reports.
 */
export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || "Asia/Jakarta";

export function formatBusinessDateTime(date: Date, pattern = "yyyy-MM-dd HH:mm:ss"): string {
  return formatInTimeZone(date, BUSINESS_TIMEZONE, pattern);
}

export function formatBusinessDate(date: Date): string {
  return formatInTimeZone(date, BUSINESS_TIMEZONE, "yyyy-MM-dd");
}

/** "16 Sep 2026 14.05" — the short Indonesian-locale form every list and detail screen shows. */
export function formatDisplayDateTime(value: Date | string): string {
  return new Date(value).toLocaleString("id-ID", { timeZone: BUSINESS_TIMEZONE, dateStyle: "medium", timeStyle: "short" });
}

/**
 * An inclusive range of business calendar dates (YYYY-MM-DD, Asia/Jakarta).
 * Date-only columns (expenses.expense_date, purchases.purchase_date) compare
 * against these strings directly; timestamp columns use `businessDayBounds`.
 */
export interface BusinessDateRange {
  from: string;
  to: string;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real Y-M-D calendar date (rejects e.g. 2026-02-30). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validated range from untrusted query params: invalid or missing dates fall
 * back to the defaults, and a reversed range is put back in order.
 */
export function resolveBusinessDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
  defaults: BusinessDateRange,
): BusinessDateRange {
  const start = isCalendarDate(from) ? from : defaults.from;
  const end = isCalendarDate(to) ? to : defaults.to;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

/**
 * Half-open UTC instants covering the range: `start` is 00:00 Jakarta on
 * `from`, `endExclusive` is 00:00 Jakarta on the day after `to`. Filter
 * timestamps with `>= start AND < endExclusive` — no 23:59:59.999 edge.
 */
export function businessDayBounds(range: BusinessDateRange): { start: Date; endExclusive: Date } {
  return {
    start: startOfBusinessDay(range.from),
    endExclusive: startOfBusinessDay(shiftBusinessDate(range.to, 1)),
  };
}

/** Number of calendar days in an inclusive range (a single day is 1). */
export function calendarDaysInclusive(range: BusinessDateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** The same number of calendar days immediately before the range. */
export function previousBusinessPeriod(range: BusinessDateRange): BusinessDateRange {
  const days = calendarDaysInclusive(range);
  return { from: shiftBusinessDate(range.from, -days), to: shiftBusinessDate(range.from, -1) };
}

/** Start-of-day (00:00:00 Asia/Jakarta) for a given calendar date, as a UTC Date. */
function startOfBusinessDay(calendarDate: string): Date {
  return fromZonedTime(`${calendarDate}T00:00:00`, BUSINESS_TIMEZONE);
}

/** The current date, as a Y-M-D string in the business timezone. */
export function todayInBusinessTimezone(): string {
  return formatBusinessDate(new Date());
}

/**
 * Shift a Y-M-D calendar date by `days` (negative to go back). Pure calendar
 * math on the date-only string — safe without a timezone conversion because
 * Asia/Jakarta has no DST (fixed UTC+7), so a day is always 24h wall-clock.
 */
export function shiftBusinessDate(calendarDate: string, days: number): string {
  const d = new Date(`${calendarDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
