import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import {
  getExpenseSummary,
  getExpensesByCategory,
  getExpensesByDay,
  countExpensesInRange,
  listExpensesInRange,
} from "@/server/services/expense-service";
import {
  calendarDaysInclusive,
  isCalendarDate,
  previousBusinessPeriod,
  resolveBusinessDateRange,
  shiftBusinessDate,
  todayInBusinessTimezone,
} from "@/lib/dates/dates";
import { pageWindow, parsePageParam, toPage } from "@/lib/pagination";
import { ServerPagination } from "@/components/ui/server-pagination";
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
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const user = await requirePageAccess("expenses:write");
  const { from, to, page } = await searchParams;

  const today = todayInBusinessTimezone();
  const defaultTo = isCalendarDate(to) ? to : today;
  const range = resolveBusinessDateRange(from, to, { from: shiftBusinessDate(defaultTo, -DEFAULT_DAYS_BACK), to: defaultTo });
  const { from: fromDate, to: toDate } = range;

  // "vs. last period": the same number of days immediately preceding the range.
  const rangeLengthDays = calendarDaysInclusive(range);
  const previousRange = previousBusinessPeriod(range);

  // The trend chart holds a fixed trailing 14-day window ending on `toDate`,
  // independent of the cards' range — so it still reads as a trend when the
  // Daily preset narrows the cards to a single day.
  const chartFromDate = shiftBusinessDate(toDate, -(CHART_DAYS - 1));
  const window = pageWindow(parsePageParam(page));

  const [rows, totalItems, summary, previousSummary, byCategory, byDay] = await Promise.all([
    listExpensesInRange(db, user.businessId, range, window),
    countExpensesInRange(db, user.businessId, range),
    getExpenseSummary(db, user.businessId, range),
    getExpenseSummary(db, user.businessId, previousRange),
    getExpensesByCategory(db, user.businessId, range),
    getExpensesByDay(db, user.businessId, { from: chartFromDate, to: toDate }),
  ]);
  const records = toPage(rows, window.page, window.pageSize);

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
        records={records.rows}
        pagination={
          <ServerPagination
            page={{ ...records, rowCount: records.rows.length }}
            totalItems={totalItems}
            basePath="/expenses"
            params={{ from: fromDate, to: toDate }}
          />
        }
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
