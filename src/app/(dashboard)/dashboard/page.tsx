import { formatIDR } from "@/lib/money/money";
import { formatDisplayQuantity, resolveDisplayUnit } from "@/lib/units/units";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Wallet,
  ShoppingCart,
  Receipt,
  Package,
  TrendingUp,
  Percent,
  CreditCard,
  PiggyBank,
  XCircle,
  Trash2,
} from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { db, reportDb } from "@/lib/db/client";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import {
  getFailedPrintJobs,
  getRecentOrders,
  getSalesByCategoryWithModifiers,
  getSalesByPaymentMethod,
  getSalesTrend,
  getTopMenuItemRankings,
  getSalesSummary,
  getStockAlerts,
} from "@/server/services/reports-service";
import {
  bucketStarts,
  calendarDaysInclusive,
  chartGranularity,
  MAX_REPORT_RANGE_DAYS,
  previousBusinessPeriod,
  resolveReportDateRange,
  shiftBusinessDate,
  todayInBusinessTimezone,
} from "@/lib/dates/dates";
import { Badge } from "@/components/ui/badge";
import { ItemThumbnail } from "@/components/ui/item-thumbnail";
import { getMenuItemImages } from "@/server/services/menu-service";
import { DateRangeForm } from "@/components/ui/date-range-form";
import { StatCard as Card, computeTrend } from "@/components/ui/stat-card";
import { TrendChart, type TrendPoint } from "@/components/ui/trend-chart";
import { PieChart } from "@/components/ui/pie-chart";

export const metadata: Metadata = {
  title: "Dashboard — CaféOps",
};

/** Rows per ranking widget. */
const MENU_RANKING_ROWS = 5;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePageAccess("reports:read");
  const { from, to } = await searchParams;
  if (!(await allowUserAction(db, RATE_LIMITS.reportRead(), user))) return <ReportsThrottled />;

  const today = todayInBusinessTimezone();
  // Capped at MAX_REPORT_RANGE_DAYS; a longer request keeps its most recent part.
  const { range, clamped } = resolveReportDateRange(from, to, { from: today, to: today });
  const { from: fromDate, to: toDate } = range;

  // The trend chart follows the same date-range filter as the KPI cards
  // above, except when that range collapses to a single day (the "Daily"
  // preset, the default on first load) — a one-bar chart isn't a trend, so
  // that case falls back to a trailing 14-day window ending on `toDate`.
  const chartDayCount = calendarDaysInclusive(range);
  const chartFromDate = chartDayCount > 1 ? fromDate : shiftBusinessDate(toDate, -13);
  const chartRange = { from: chartFromDate, to: toDate };
  // Daily up to two months, then weekly, then monthly — never more than ~62 points.
  const granularity = chartGranularity(calendarDaysInclusive(chartRange));

  // "vs. last period" comparison: the same number of calendar days
  // immediately preceding the selected range (a single day compares with
  // the day before).
  const previousRange = previousBusinessPeriod(range);

  // Independent report queries, issued together but served by the small
  // reports pool (DATABASE_REPORT_POOL_MAX): they queue there instead of
  // taking the connections checkout needs. Images below stay sequential —
  // they need ranking IDs.
  const [summary, previousSummary, stockAlerts, rankings, recentOrders, failedPrints, salesTrend, salesByCategory, salesByPaymentMethod] = await Promise.all([
    getSalesSummary(reportDb, user.businessId, range),
    getSalesSummary(reportDb, user.businessId, previousRange),
    getStockAlerts(reportDb, user.businessId, 6),
    // Ranked and cut in SQL: the page gets at most five rows per widget
    // rather than every menu item sold in the range.
    getTopMenuItemRankings(reportDb, user.businessId, range, MENU_RANKING_ROWS),
    getRecentOrders(reportDb, user.businessId, 8),
    getFailedPrintJobs(reportDb, user.businessId),
    getSalesTrend(reportDb, user.businessId, chartRange, granularity),
    getSalesByCategoryWithModifiers(reportDb, user.businessId, range),
    getSalesByPaymentMethod(reportDb, user.businessId, range),
  ]);

  const salesByBucket = new Map(salesTrend.map((d) => [d.day, d]));
  const trendData: TrendPoint[] = bucketStarts(chartRange, granularity).map((day) => {
    const row = salesByBucket.get(day);
    return { day, value: row?.totalSales ?? 0, caption: `${row?.orderCount ?? 0} orders` };
  });

  const { lowStock, outOfStock } = stockAlerts;
  const { topSelling, highestCogs } = rankings;
  // Only the items actually rendered below — at most ten distinct ids.
  const images = await getMenuItemImages(
    reportDb,
    user.businessId,
    [...new Set([...topSelling, ...highestCogs].map((i) => i.menuItemId).filter((id): id is string => id !== null))],
  );
  const itemLabel = (item: { menuItemId: string | null; name: string }) => (
    <span className="flex min-w-0 items-center gap-3">
      <ItemThumbnail imageUrl={item.menuItemId ? (images.get(item.menuItemId) ?? null) : null} name={item.name} size="sm" />
      <span className="truncate">{item.name}</span>
    </span>
  );

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Welcome back, {user.name}.</p>
        </div>
        <DateRangeForm from={fromDate} to={toDate} today={today} basePath="/dashboard" />
      </div>
      {clamped ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Ranges are limited to {MAX_REPORT_RANGE_DAYS} days, so this shows {fromDate} to {toDate}.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card
          icon={Wallet}
          label="Total sales"
          value={formatIDR(summary.totalSales)}
          trend={computeTrend(summary.totalSales, previousSummary.totalSales)}
          previousLabel={`vs. ${formatIDR(previousSummary.totalSales)} last period`}
        />
        <Card
          icon={ShoppingCart}
          label="Orders"
          value={summary.orderCount.toLocaleString("id-ID")}
          trend={computeTrend(summary.orderCount, previousSummary.orderCount)}
          previousLabel={`vs. ${previousSummary.orderCount.toLocaleString("id-ID")} last period`}
        />
        <Card icon={Receipt} label="Avg order value" value={formatIDR(summary.averageOrderValue)} />
        <Card icon={Package} label="COGS" value={formatIDR(summary.cogsTotal)} />
        <Card
          icon={TrendingUp}
          label="Gross profit"
          value={formatIDR(summary.grossProfit)}
          trend={computeTrend(summary.grossProfit, previousSummary.grossProfit)}
          previousLabel={`vs. ${formatIDR(previousSummary.grossProfit)} last period`}
        />
        <Card icon={Percent} label="Gross margin" value={summary.grossMarginPercentage !== null ? `${summary.grossMarginPercentage.toFixed(1)}%` : "—"} />
        <Card icon={CreditCard} label="Expenses" value={formatIDR(summary.expensesTotal)} />
        <Card
          icon={PiggyBank}
          label="Est. net profit"
          value={formatIDR(summary.estimatedNetProfit)}
          trend={computeTrend(summary.estimatedNetProfit, previousSummary.estimatedNetProfit)}
          previousLabel={`vs. ${formatIDR(previousSummary.estimatedNetProfit)} last period`}
          emphasize
        />
        <Card icon={XCircle} label="Cancelled/refunded" value={formatIDR(summary.cancelledRefundedAmount)} tone="danger" />
        <Card icon={Trash2} label="Waste cost" value={formatIDR(summary.wasteCost)} tone="warning" />
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        Estimated net profit is gross profit minus recorded expenses — not audited accounting profit.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Sales trend {chartDayCount > 1 ? `— ${chartFromDate} to ${toDate}` : "— last 14 days"}
          </h2>
          <div className="mt-3">
            <TrendChart
              data={trendData}
              granularity={granularity}
              ariaLabel={`${granularity === "day" ? "Daily" : granularity === "week" ? "Weekly" : "Monthly"} total sales from ${chartFromDate} to ${toDate}`}
              emptyText="No sales in this range."
            />
          </div>
        </div>

        <Widget title="Low stock" className="lg:col-span-1">
          {lowStock.length === 0 ? (
            <EmptyRow text="Nothing below its reorder level." />
          ) : (
            lowStock.map((i) => (
              <WidgetRow
                key={i.id}
                left={i.name}
                right={
                  <span className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                      {formatDisplayQuantity(i.currentQuantityBaseUnits, resolveDisplayUnit(i.baseUnit, i.displayUnit))} /{" "}
                      {formatDisplayQuantity(i.reorderLevelBaseUnits!, resolveDisplayUnit(i.baseUnit, i.displayUnit))}
                    </span>
                    <Badge tone="warning">Low</Badge>
                  </span>
                }
              />
            ))
          )}
        </Widget>

        <Widget title="Out of stock" className="lg:col-span-1">
          {outOfStock.length === 0 ? (
            <EmptyRow text="Nothing is out of stock." />
          ) : (
            outOfStock.map((i) => (
              <WidgetRow
                key={i.id}
                left={i.name}
                right={
                  <span className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                      {formatDisplayQuantity("0", resolveDisplayUnit(i.baseUnit, i.displayUnit))}
                      {i.reorderLevelBaseUnits
                        ? ` / ${formatDisplayQuantity(i.reorderLevelBaseUnits, resolveDisplayUnit(i.baseUnit, i.displayUnit))}`
                        : ""}
                    </span>
                    <Badge tone="danger">Out</Badge>
                  </span>
                }
              />
            ))
          )}
        </Widget>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Widget title="Top-selling items">
          {topSelling.length === 0 ? (
            <EmptyRow text="No sales in this range yet." />
          ) : (
            topSelling.map((item) => (
              <WidgetRow key={item.menuItemId ?? item.name} left={itemLabel(item)} right={<span className="tabular-nums">{item.quantitySold} sold</span>} />
            ))
          )}
        </Widget>

        <Widget title="Highest COGS items">
          {highestCogs.length === 0 ? (
            <EmptyRow text="No sales in this range yet." />
          ) : (
            highestCogs.map((item) => (
              <WidgetRow key={item.menuItemId ?? item.name} left={itemLabel(item)} right={<span className="tabular-nums">{formatIDR(item.cogs)}</span>} />
            ))
          )}
        </Widget>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Widget title="Recent orders">
          {recentOrders.length === 0 ? (
            <EmptyRow text="No orders yet." />
          ) : (
            recentOrders.map((o) => (
              <WidgetRow
                key={o.id}
                left={
                  <Link href={`/orders/${o.id}`} className="text-xs text-[var(--color-accent-primary)] hover:underline">
                    {o.orderNumber}
                  </Link>
                }
                right={<span className="tabular-nums">{formatIDR(o.total)}</span>}
              />
            ))
          )}
        </Widget>

        <Widget title="Failed print jobs">
          {failedPrints.length === 0 ? (
            <EmptyRow text="No failed prints." />
          ) : (
            failedPrints.map((p) => (
              <WidgetRow
                key={p.id}
                left={
                  <Link href={`/orders/${p.orderId}`} className="text-xs text-[var(--color-accent-primary)] hover:underline">
                    {p.orderNumber}
                  </Link>
                }
                right={p.uncertain ? <Badge tone="warning">Outcome unknown</Badge> : <Badge tone="danger">Failed</Badge>}
              />
            ))
          )}
        </Widget>

        <Widget title="Sales by category" subtitle="Gross, before order-level discounts">
          <PieChart
            data={[
              ...salesByCategory.categories.map((r) => ({ label: r.categoryName, value: r.revenue, caption: `${r.quantitySold} sold` })),
              {
                label: "Modifiers",
                value: salesByCategory.modifiers.revenue,
                caption: `${salesByCategory.modifiers.quantitySold} added`,
                pinned: true,
              },
            ]}
            ariaLabel="Share of revenue by menu category"
            emptyText="No sales in this range yet."
          />
        </Widget>

        <Widget title="Payment methods" subtitle="Net, after discounts and tax/service charge">
          <PieChart
            data={salesByPaymentMethod.map((r) => ({
              label: r.paymentMethodLabel,
              value: r.revenue,
              caption: `${r.orderCount} ${r.orderCount === 1 ? "order" : "orders"}`,
            }))}
            ariaLabel="Share of revenue by payment method"
            emptyText="No sales in this range yet."
          />
        </Widget>
      </div>
    </div>
  );
}

function ReportsThrottled() {
  return (
    <div className="mx-auto max-w-[1440px]">
      <p className="text-sm text-[var(--color-text-secondary)]">Too many report requests in a short time. Wait a minute, then reload.</p>
    </div>
  );
}

function Widget({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // h-full so widgets sharing a grid row (e.g. Low stock / Out of stock) stretch to match
    // each other's height instead of each shrink-wrapping its own row count.
    <div className={`flex h-full flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 ${className ?? ""}`}>
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
      {subtitle ? <p className="mb-2 text-xs text-[var(--color-text-muted)]">{subtitle}</p> : null}
      <div className={`flex flex-1 flex-col divide-y divide-[var(--color-border)] ${subtitle ? "" : "mt-2"}`}>{children}</div>
    </div>
  );
}

function WidgetRow({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="min-w-0 truncate text-[var(--color-text-primary)]">{left}</span>
      <span className="shrink-0">{right}</span>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="py-2 text-sm text-[var(--color-text-secondary)]">{text}</p>;
}
