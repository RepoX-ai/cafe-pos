/**
 * Shared month-grid maths for the date pickers. Plain module (no "use client")
 * so both client pickers and any server caller can import it.
 *
 * Parse a Y-M-D string as a UTC-anchored Date and format with UTC getters
 * throughout — never `new Date(value)` / local getters, which are affected by
 * the runtime's local timezone and can land a day off. Same convention as
 * src/lib/dates/dates.ts's `shiftBusinessDate`.
 */

/** Monday-first weekday header (id-ID convention). */
export const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function toValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDisplay(value: string): string {
  return toDateOnly(value).toLocaleDateString("id-ID", { dateStyle: "medium", timeZone: "UTC" });
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function mondayFirstIndex(jsWeekday: number): number {
  return (jsWeekday + 6) % 7; // JS: Sun=0..Sat=6 -> Mon=0..Sun=6
}

export interface MonthCell {
  date: Date;
  value: string;
  inMonth: boolean;
}

/** A fixed 6-row (42-cell) grid for the month `viewDate` falls in, padded with
 *  neighbouring days so the popover never changes height between months. */
export function buildMonthCells(viewDate: Date): MonthCell[] {
  const year = viewDate.getUTCFullYear();
  const month = viewDate.getUTCMonth();
  const totalDays = daysInMonth(year, month);
  const leading = mondayFirstIndex(new Date(Date.UTC(year, month, 1)).getUTCDay());

  const cells: MonthCell[] = [];
  const push = (date: Date, inMonth: boolean) => cells.push({ date, value: toValue(date), inMonth });

  for (let i = leading; i > 0; i--) push(new Date(Date.UTC(year, month, 1 - i)), false);
  for (let day = 1; day <= totalDays; day++) push(new Date(Date.UTC(year, month, day)), true);
  for (let day = 1; cells.length < 42; day++) push(new Date(Date.UTC(year, month + 1, day)), false);

  return cells;
}
