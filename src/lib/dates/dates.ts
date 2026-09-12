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

/** Start-of-day (00:00:00 Asia/Jakarta) for a given calendar date, as a UTC Date. */
export function startOfBusinessDay(calendarDate: string): Date {
  return fromZonedTime(`${calendarDate}T00:00:00`, BUSINESS_TIMEZONE);
}

/** End-of-day (23:59:59.999 Asia/Jakarta) for a given calendar date, as a UTC Date. */
export function endOfBusinessDay(calendarDate: string): Date {
  return fromZonedTime(`${calendarDate}T23:59:59.999`, BUSINESS_TIMEZONE);
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
