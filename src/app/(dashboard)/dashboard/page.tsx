import { formatIDR } from "@/lib/money/money";
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
import { db } from "@/lib/db/client";
import {
  getFailedPrintJobs,
  getRecentOrders,
  getSalesByDay,
  getSalesByMenuItem,
  getSalesSummary,
  getStockAlerts,
} from "@/server/services/reports-service";
import {
  previousBusinessPeriod,
  resolveBusinessDateRange,
  shiftBusinessDate,
  todayInBusinessTimezone,
} from "@/lib/dates/dates";
import { Badge } from "@/components/ui/badge";
import { DateRangeForm } from "@/components/ui/date-range-form";
import { StatCard as Card, computeTrend } from "@/components/ui/stat-card";
import { TrendChart, type TrendPoint } from "@/components/ui/trend-chart";

export const metadata: Metadata = {
  title: "Dashboard — CaféOps",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePageAccess("reports:read");
  const { from, to } = await searchParams;

  const today = todayInBusinessTimezone();
  const range = resolveBusinessDateRange(from, to, { from: today, to: today });
  const { from: fromDate, to: toDate } = range;

  // The trend chart always shows a fixed trailing 14-day window ending on
  // `toDate`, independent of the KPI cards' date-range filter above — so it
  // reads as a trend on first load instead of the single bar you'd get from
  // the cards' today-only default.
  const chartFromDate = shiftBusinessDate(toDate, -13);
  const chartRange = { from: chartFromDate, to: toDate };

  // "vs. last period" comparison: the same number of calendar days
  // immediately preceding the selected range (a single day compares with
  // the day before).
  const previousRange = previousBusinessPeriod(range);

  const [summary, previousSummary, stockAlerts, topItems, recentOrders, failedPrints, salesByDay] = await Promise.all([
    getSalesSummary(db, user.businessId, range),
    getSalesSummary(db, user.businessId, previousRange),
    getStockAlerts(db, user.businessId, 6),
    getSalesByMenuItem(db, user.businessId, range),
    getRecentOrders(db, user.businessId, 8),
    getFailedPrintJobs(db, user.businessId),
    getSalesByDay(db, user.businessId, chartRange),
  ]);

  const salesByDayMap = new Map(salesByDay.map((d) => [d.day, d]));
  const trendData: TrendPoint[] = Array.from({ length: 14 }, (_, i) => {
    const day = shiftBusinessDate(chartFromDate, i);
    const row = salesByDayMap.get(day);
    return { day, value: row?.totalSales ?? 0, caption: `${row?.orderCount ?? 0} orders` };
  });

  const { lowStock, outOfStock } = stockAlerts;
  const topSelling = [...topItems].sort((a, b) => b.quantitySold - a.quantitySold).slice(0, 5);
  const highestCogs = [...topItems].sort((a, b) => b.cogs - a.cogs).slice(0, 5);

  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Welcome back, {user.name}.</p>
        </div>
        <DateRangeForm from={fromDate} to={toDate} today={today} basePath="/dashboard" />
      </div>

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
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Sales trend — last 14 days</h2>
          <div className="mt-3">
            <TrendChart
              data={trendData}
              ariaLabel="Daily total sales for the last 14 days"
              emptyText="No sales in the last 14 days."
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
                      {Number(i.currentQuantityBaseUnits).toLocaleString("id-ID")} / {Number(i.reorderLevelBaseUnits).toLocaleString("id-ID")}
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
                      0{i.reorderLevelBaseUnits ? ` / ${Number(i.reorderLevelBaseUnits).toLocaleString("id-ID")}` : ""}
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
              <WidgetRow key={item.menuItemId ?? item.name} left={item.name} right={<span className="tabular-nums">{item.quantitySold} sold</span>} />
            ))
          )}
        </Widget>

        <Widget title="Highest COGS items">
          {highestCogs.length === 0 ? (
            <EmptyRow text="No sales in this range yet." />
          ) : (
            highestCogs.map((item) => (
              <WidgetRow key={item.menuItemId ?? item.name} left={item.name} right={<span className="tabular-nums">{formatIDR(item.cogs)}</span>} />
            ))
          )}
        </Widget>

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
      </div>
    </div>
  );
}

function Widget({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    // h-full so widgets sharing a grid row (e.g. Low stock / Out of stock) stretch to match
    // each other's height instead of each shrink-wrapping its own row count.
    <div className={`flex h-full flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 ${className ?? ""}`}>
      <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
      <div className="flex flex-col divide-y divide-[var(--color-border)]">{children}</div>
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
