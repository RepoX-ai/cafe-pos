import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listIngredients } from "@/server/services/ingredient-service";
import {
  getFailedPrintJobs,
  getRecentOrders,
  getSalesByMenuItem,
  getSalesSummary,
} from "@/server/services/reports-service";
import { startOfBusinessDay, endOfBusinessDay, todayInBusinessTimezone } from "@/lib/dates/dates";
import { Badge } from "@/components/ui/badge";
import { DateRangeForm } from "./date-range-form";

export const metadata: Metadata = {
  title: "Dashboard — CaféOps",
};

function formatIDR(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requirePageAccess("reports:read");
  const { from, to } = await searchParams;

  const fromDate = from || todayInBusinessTimezone();
  const toDate = to || todayInBusinessTimezone();
  const range = { from: startOfBusinessDay(fromDate), to: endOfBusinessDay(toDate) };

  const [summary, ingredients, topItems, recentOrders, failedPrints] = await Promise.all([
    getSalesSummary(db, user.businessId, range),
    listIngredients(db, user.businessId),
    getSalesByMenuItem(db, user.businessId, range),
    getRecentOrders(db, user.businessId, 8),
    getFailedPrintJobs(db, user.businessId),
  ]);

  const lowStock = ingredients.filter(
    (i) => i.reorderLevelBaseUnits && Number(i.currentQuantityBaseUnits) <= Number(i.reorderLevelBaseUnits),
  );
  const outOfStock = ingredients.filter((i) => Number(i.currentQuantityBaseUnits) <= 0);
  const topSelling = [...topItems].sort((a, b) => b.quantitySold - a.quantitySold).slice(0, 5);
  const highestCogs = [...topItems].sort((a, b) => b.cogs - a.cogs).slice(0, 5);

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Welcome back, {user.name}.</p>
        </div>
        <DateRangeForm from={fromDate} to={toDate} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card label="Total sales" value={formatIDR(summary.totalSales)} />
        <Card label="Orders" value={summary.orderCount.toLocaleString("id-ID")} />
        <Card label="Avg order value" value={formatIDR(summary.averageOrderValue)} />
        <Card label="COGS" value={formatIDR(summary.cogsTotal)} />
        <Card label="Gross profit" value={formatIDR(summary.grossProfit)} />
        <Card label="Gross margin" value={summary.grossMarginPercentage !== null ? `${summary.grossMarginPercentage.toFixed(1)}%` : "—"} />
        <Card label="Expenses" value={formatIDR(summary.expensesTotal)} />
        <Card label="Est. net profit" value={formatIDR(summary.estimatedNetProfit)} emphasize />
        <Card label="Cancelled/refunded" value={formatIDR(summary.cancelledRefundedAmount)} tone="danger" />
        <Card label="Waste cost" value={formatIDR(summary.wasteCost)} tone="warning" />
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        Estimated net profit is gross profit minus recorded expenses — not audited accounting profit.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Widget title="Low stock">
          {lowStock.length === 0 ? (
            <EmptyRow text="Nothing below its reorder level." />
          ) : (
            lowStock.slice(0, 6).map((i) => (
              <WidgetRow key={i.id} left={i.name} right={<Badge tone="warning">{Number(i.currentQuantityBaseUnits).toLocaleString("id-ID")}</Badge>} />
            ))
          )}
        </Widget>

        <Widget title="Out of stock">
          {outOfStock.length === 0 ? (
            <EmptyRow text="Nothing is out of stock." />
          ) : (
            outOfStock.slice(0, 6).map((i) => <WidgetRow key={i.id} left={i.name} right={<Badge tone="danger">0</Badge>} />)
          )}
        </Widget>

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
                  <Link href={`/orders/${o.id}`} className="font-mono text-xs text-[var(--color-accent-primary)] hover:underline">
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
                  <Link href={`/orders/${p.orderId}`} className="font-mono text-xs text-[var(--color-accent-primary)] hover:underline">
                    {p.orderNumber}
                  </Link>
                }
                right={<Badge tone="danger">Failed</Badge>}
              />
            ))
          )}
        </Widget>
      </div>
    </div>
  );
}

function Card({ label, value, tone, emphasize }: { label: string; value: string; tone?: "danger" | "warning"; emphasize?: boolean }) {
  const color =
    tone === "danger" ? "text-[var(--color-danger)]" : tone === "warning" ? "text-[var(--color-warning)]" : "text-[var(--color-text-primary)]";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={`mt-1 tabular-nums ${emphasize ? "text-xl font-semibold" : "text-base font-semibold"} ${color}`}>{value}</p>
    </div>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
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
