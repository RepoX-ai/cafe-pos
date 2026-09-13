import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import {
  getExpenseSummary,
  getExpensesByCategory,
  getExpensesByDay,
  listExpensesInRange,
} from "@/server/services/expense-service";
import { shiftBusinessDate, todayInBusinessTimezone } from "@/lib/dates/dates";
import type { TrendPoint } from "@/components/ui/trend-chart";
import { ExpensesClient } from "./expenses-client";

export const metadata: Metadata = {
  title: "Expenses — CaféOps",
};

/** Days back for the default view. Expenses are recorded weekly/monthly (rent,
 *  salaries, utilities), so a today-only default would show an empty page most
 *  days — unlike the dashboard, where sales land daily. */
const DEFAULT_DAYS_BACK = 29;

const CHART_DAYS = 14;

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePageAccess("expenses:write");
  const { from, to } = await searchParams;

  const today = todayInBusinessTimezone();
  const toDate = to || today;
  const fromDate = from || shiftBusinessDate(toDate, -DEFAULT_DAYS_BACK);
  const range = { from: fromDate, to: toDate };

  // "vs. last period": the same number of days immediately preceding the range.
  const rangeLengthDays = daysBetween(fromDate, toDate) + 1;
  const previousRange = {
    from: shiftBusinessDate(fromDate, -rangeLengthDays),
    to: shiftBusinessDate(fromDate, -1),
  };

  // The trend chart holds a fixed trailing 14-day window ending on `toDate`,
  // independent of the cards' range — so it still reads as a trend when the
  // Daily preset narrows the cards to a single day.
  const chartFromDate = shiftBusinessDate(toDate, -(CHART_DAYS - 1));

  const [records, summary, previousSummary, byCategory, byDay] = await Promise.all([
    listExpensesInRange(db, user.businessId, range),
    getExpenseSummary(db, user.businessId, range),
    getExpenseSummary(db, user.businessId, previousRange),
    getExpensesByCategory(db, user.businessId, range),
    getExpensesByDay(db, user.businessId, { from: chartFromDate, to: toDate }),
  ]);

  const byDayMap = new Map(byDay.map((d) => [d.day, d]));
  const trendData: TrendPoint[] = Array.from({ length: CHART_DAYS }, (_, i) => {
    const day = shiftBusinessDate(chartFromDate, i);
    const row = byDayMap.get(day);
    const entryCount = row?.entryCount ?? 0;
    return {
      day,
      value: row?.total ?? 0,
      caption: `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`,
    };
  });

  return (
    <div className="mx-auto max-w-[1440px]">
      <ExpensesClient
        records={records}
        summary={summary}
        previousSummary={previousSummary}
        byCategory={byCategory}
        trendData={trendData}
        rangeLengthDays={rangeLengthDays}
        from={fromDate}
        to={toDate}
        today={today}
      />
    </div>
  );
}

/** Whole days from one Y-M-D calendar date to another. Asia/Jakarta has no DST
 *  (fixed UTC+7), so plain UTC arithmetic on the date-only strings is exact. */
function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / 86_400_000);
}
