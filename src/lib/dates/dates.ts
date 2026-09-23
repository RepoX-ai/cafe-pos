import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * All timestamps are stored in UTC (Postgres `timestamptz`). This module is
 * the single place that converts to/from the business display timezone
 * (Asia/Jakarta, WIB, UTC+7 — no DST) for anything shown to staff or
 * exported in reports.
 *
 * One timezone for the whole install, the same in the server and in the
 * browser. It is fixed at build time (NEXT_PUBLIC_BUSINESS_TIMEZONE,
 * default Asia/Jakarta) because client components format dates too, and a
 * runtime-only variable is undefined in the browser — the two used to be
 * able to disagree. `businesses.timezone` is not read anywhere; every café
 * on one install shares this zone. Startup refuses a runtime
 * BUSINESS_TIMEZONE that differs from it (see assertBusinessTimezoneConfig).
 */
export const BUSINESS_TIMEZONE = process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE || "Asia/Jakarta";

export class BusinessTimezoneConfigError extends Error {}

/** Startup check: the build-time zone is a real IANA zone and any runtime BUSINESS_TIMEZONE agrees with it. */
export function assertBusinessTimezoneConfig(env: Record<string, string | undefined> = process.env, buildZone = BUSINESS_TIMEZONE): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: buildZone });
  } catch {
    throw new BusinessTimezoneConfigError(`NEXT_PUBLIC_BUSINESS_TIMEZONE "${buildZone}" is not a valid IANA timezone.`);
  }
  const runtime = env.BUSINESS_TIMEZONE?.trim();
  if (runtime && runtime !== buildZone) {
    throw new BusinessTimezoneConfigError(
      `BUSINESS_TIMEZONE is "${runtime}" but this build uses "${buildZone}". The timezone is fixed at build time ` +
        "so the server and browser agree: rebuild with NEXT_PUBLIC_BUSINESS_TIMEZONE set, or unset BUSINESS_TIMEZONE.",
    );
  }
}

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

/**
 * The calendar dates this app accepts anywhere. Far outside any café's
 * records, but bounded: year 0001 or 9999 used to pass validation and then
 * break day arithmetic (9999-12-31 + 1 day is not a 4-digit year) or make a
 * report walk millions of days.
 */
export const MIN_CALENDAR_DATE = "2000-01-01";
export const MAX_CALENDAR_DATE = "2099-12-31";

/**
 * Longest range an interactive report screen, the dashboard or a CSV export
 * will cover in one request. A longer request is shortened to end on its
 * `to` date (the most recent part), and the page says so.
 */
export const MAX_REPORT_RANGE_DAYS = 366;

/** True for a real Y-M-D calendar date within the supported years (rejects e.g. 2026-02-30). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DATE.test(value)) return false;
  if (value < MIN_CALENDAR_DATE || value > MAX_CALENDAR_DATE) return false;
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
 * `resolveBusinessDateRange`, then capped at `maxDays` (default
 * MAX_REPORT_RANGE_DAYS) by moving `from` forward. `clamped` tells the page
 * to say the range was shortened rather than silently showing less.
 */
export function resolveReportDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
  defaults: BusinessDateRange,
  maxDays = MAX_REPORT_RANGE_DAYS,
): { range: BusinessDateRange; clamped: boolean } {
  const range = resolveBusinessDateRange(from, to, defaults);
  if (calendarDaysInclusive(range) <= maxDays) return { range, clamped: false };
  return { range: { from: shiftBusinessDate(range.to, -(maxDays - 1)), to: range.to }, clamped: true };
}

export type ChartGranularity = "day" | "week" | "month";

/**
 * How to bucket a trend chart over `days` so it never has more than ~62
 * points: daily up to two months, weekly (Monday-start) up to ~6 months,
 * monthly beyond. The SQL groups by the same unit, so totals are unchanged.
 */
export function chartGranularity(days: number): ChartGranularity {
  if (days <= 62) return "day";
  if (days <= 190) return "week";
  return "month";
}

/** Start date of the bucket containing `calendarDate` (Monday for weeks, the 1st for months). */
export function bucketStart(calendarDate: string, granularity: ChartGranularity): string {
  if (granularity === "day") return calendarDate;
  if (granularity === "month") return `${calendarDate.slice(0, 7)}-01`;
  const weekday = new Date(`${calendarDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftBusinessDate(calendarDate, -((weekday + 6) % 7));
}

/** Every bucket start from the bucket containing `range.from` through the one containing `range.to`. */
export function bucketStarts(range: BusinessDateRange, granularity: ChartGranularity): string[] {
  const starts: string[] = [];
  let cursor = bucketStart(range.from, granularity);
  while (cursor <= range.to) {
    starts.push(cursor);
    if (granularity === "day") cursor = shiftBusinessDate(cursor, 1);
    else if (granularity === "week") cursor = shiftBusinessDate(cursor, 7);
    else {
      const [year, month] = cursor.split("-").map(Number);
      cursor = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    }
  }
  return starts;
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
