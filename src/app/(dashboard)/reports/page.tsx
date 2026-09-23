import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { db as appDb, reportDb as db } from "@/lib/db/client";
import { allowUserAction, RATE_LIMITS } from "@/server/services/rate-limit";
import { formatBusinessDateTime, MAX_REPORT_RANGE_DAYS, resolveReportDateRange, todayInBusinessTimezone, type BusinessDateRange } from "@/lib/dates/dates";
import { formatIDR, formatIDRRate } from "@/lib/money/money";
import { pageWindow, parsePageParam, toPage, type Page } from "@/lib/pagination";
import { Select } from "@/components/ui/form-field";
import { DatePicker } from "@/components/ui/date-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { ServerPagination } from "@/components/ui/server-pagination";
import { countExpensesInRange, listExpensesInRange } from "@/server/services/expense-service";
import { listIngredients, listLowStockIngredients } from "@/server/services/ingredient-service";
import { countMovements, listMovements } from "@/server/services/inventory-service";
import { countPurchases, listPurchases } from "@/server/services/purchase-service";
import { isReportType, REPORT_TYPE_LABELS, REPORT_TYPES, type ReportType } from "@/server/services/report-exports";
import { countWasteRecords, listWasteRecords } from "@/server/services/waste-service";
import {
  countCancelledRefundedOrders,
  getCancelledRefundedOrders,
  getSalesByCategory,
  getSalesByDay,
  getSalesByMenuItem,
  getSalesByPaymentMethod,
} from "@/server/services/reports-service";
import { ReportTable } from "./report-table";

export const metadata: Metadata = {
  title: "Reports — CaféOps",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; from?: string; to?: string; page?: string }>;
}) {
  const user = await requirePageAccess("reports:read");
  const { type: typeParam, from, to, page } = await searchParams;
  if (!(await allowUserAction(appDb, RATE_LIMITS.reportRead(), user))) {
    return (
      <div className="mx-auto max-w-[1440px]">
        <p className="text-sm text-[var(--color-text-secondary)]">Too many report requests in a short time. Wait a minute, then reload.</p>
      </div>
    );
  }

  const type: ReportType = typeParam && isReportType(typeParam) ? typeParam : "sales_by_day";
  const today = todayInBusinessTimezone();
  // Capped at MAX_REPORT_RANGE_DAYS — the same cap the CSV export applies.
  const { range, clamped } = resolveReportDateRange(from, to, { from: today, to: today });
  const fromDate = range.from;
  const toDate = range.to;

  const table = await renderReportTable(user.businessId, type, range, parsePageParam(page));

  return (
    <div className="mx-auto max-w-[1440px]">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Reports</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        All exports use Asia/Jakarta display times and respect your permissions.
      </p>

      <form className="mt-6 flex flex-wrap items-end gap-3" action="/reports">
        <div>
          <label htmlFor="type" className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
            Report
          </label>
          <Select id="type" name="type" defaultValue={type} className="w-[240px]">
            {REPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {REPORT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="from" className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
            From
          </label>
          <DatePicker id="from" name="from" defaultValue={fromDate} className="w-[160px]" />
        </div>
        <div>
          <label htmlFor="to" className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
            To
          </label>
          <DatePicker id="to" name="to" defaultValue={toDate} className="w-[160px]" />
        </div>
        <Button type="submit" variant="primary">
          Apply
        </Button>
        <a
          href={`/api/exports/reports?type=${type}&from=${fromDate}&to=${toDate}`}
          className={buttonVariants({ variant: "secondary" })}
        >
          <Download size={14} />
          Export CSV
        </a>
      </form>

      {clamped ? (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Ranges are limited to {MAX_REPORT_RANGE_DAYS} days, so this shows {fromDate} to {toDate}.
        </p>
      ) : null}

      <div className="mt-6">{table}</div>
    </div>
  );
}

async function renderReportTable(businessId: string, type: ReportType, range: BusinessDateRange, page: number) {
  // Row-level reports can grow without bound, so their screens fetch one
  // page at a time with the same filters the CSV export applies.
  const window = pageWindow(page);
  const paged = <T,>(rows: T[]) => toPage(rows, window.page, window.pageSize);
  const pagination = (result: Page<unknown>, totalItems: number) => (
    <ServerPagination
      page={{ ...result, rowCount: result.rows.length }}
      totalItems={totalItems}
      basePath="/reports"
      params={{ type, from: range.from, to: range.to }}
    />
  );

  switch (type) {
    case "sales_by_menu_item": {
      const rows = await getSalesByMenuItem(db, businessId, range);
      return (
        <ReportTable
          columns={["Menu item", "Qty sold", "Revenue", "COGS", "Gross profit"]}
          rows={rows.map((r) => [r.name, r.quantitySold, formatIDR(r.revenue), formatIDR(r.cogs), formatIDR(r.grossProfit)])}
        />
      );
    }
    case "sales_by_category": {
      const rows = await getSalesByCategory(db, businessId, range);
      return <ReportTable columns={["Category", "Qty sold", "Revenue"]} rows={rows.map((r) => [r.categoryName, r.quantitySold, formatIDR(r.revenue)])} />;
    }
    case "sales_by_payment_method": {
      const rows = await getSalesByPaymentMethod(db, businessId, range);
      return (
        <ReportTable
          columns={["Payment method", "Orders", "Revenue"]}
          rows={rows.map((r) => [r.paymentMethodLabel, r.orderCount, formatIDR(r.revenue)])}
        />
      );
    }
    case "cancelled_refunded": {
      const [rows, totalItems] = await Promise.all([getCancelledRefundedOrders(db, businessId, range, window), countCancelledRefundedOrders(db, businessId, range)]);
      const result = paged(rows);
      return (
        <ReportTable
          columns={["Order #", "Status", "Total", "Reason", "Placed at"]}
          pagination={pagination(result, totalItems)}
          rows={result.rows.map((r) => [
            <Link key={r.id} href={`/orders/${r.id}`} className="font-medium text-[var(--color-accent-primary)] hover:underline">
              {r.orderNumber}
            </Link>,
            r.status,
            formatIDR(r.total),
            r.cancellationReason ?? r.refundReason ?? "—",
            formatBusinessDateTime(r.createdAt),
          ])}
        />
      );
    }
    case "current_stock": {
      const rows = await listIngredients(db, businessId, { includeArchived: true });
      return (
        <ReportTable
          columns={["Ingredient", "Base unit", "Current qty", "Avg cost/unit"]}
          rows={rows.map((r) => [r.name, r.baseUnit, r.currentQuantityBaseUnits, formatIDRRate(r.averageCostPerBaseUnit)])}
        />
      );
    }
    case "low_stock": {
      const rows = await listLowStockIngredients(db, businessId);
      return <ReportTable columns={["Ingredient", "Current qty", "Reorder level"]} rows={rows.map((r) => [r.name, r.currentQuantityBaseUnits, r.reorderLevelBaseUnits!])} />;
    }
    case "inventory_movements": {
      const [rows, totalItems] = await Promise.all([listMovements(db, businessId, { range, ...window }), countMovements(db, businessId, { range })]);
      const result = paged(rows);
      return (
        <ReportTable
          columns={["When", "Ingredient", "Type", "Quantity", "Value"]}
          pagination={pagination(result, totalItems)}
          rows={result.rows.map((r) => [formatBusinessDateTime(r.createdAt), r.ingredientName, r.movementType, r.quantityBaseUnits, r.totalCost !== null ? formatIDR(r.totalCost) : "—"])}
        />
      );
    }
    case "purchases": {
      const [rows, totalItems] = await Promise.all([listPurchases(db, businessId, { range, ...window }), countPurchases(db, businessId, { range })]);
      const result = paged(rows);
      return (
        <ReportTable
          columns={["Date", "Supplier", "Invoice", "Status", "Total"]}
          pagination={pagination(result, totalItems)}
          rows={result.rows.map((r) => [r.purchaseDate, r.supplierName ?? "—", r.invoiceNumber ?? "—", r.status, formatIDR(r.totalCost)])}
        />
      );
    }
    case "waste": {
      const [rows, totalItems] = await Promise.all([listWasteRecords(db, businessId, { range, ...window }), countWasteRecords(db, businessId, { range })]);
      const result = paged(rows);
      return (
        <ReportTable
          columns={["When", "Ingredient", "Quantity", "Reason", "Est. cost"]}
          pagination={pagination(result, totalItems)}
          rows={result.rows.map((r) => [formatBusinessDateTime(r.createdAt), r.ingredientName, r.quantityBaseUnits, r.reason, formatIDR(r.estimatedCost)])}
        />
      );
    }
    case "expenses": {
      const [rows, totalItems] = await Promise.all([listExpensesInRange(db, businessId, range, window), countExpensesInRange(db, businessId, range)]);
      const result = paged(rows);
      return (
        <ReportTable
          columns={["Date", "Category", "Payee", "Amount"]}
          pagination={pagination(result, totalItems)}
          rows={result.rows.map((r) => [r.expenseDate, r.category, r.payee ?? "—", formatIDR(r.amount)])}
        />
      );
    }
    case "sales_by_day":
    default: {
      const rows = await getSalesByDay(db, businessId, range);
      return (
        <ReportTable
          columns={["Date", "Orders", "Total sales", "COGS", "Gross profit"]}
          rows={rows.map((r) => [r.day, r.orderCount, formatIDR(r.totalSales), formatIDR(r.cogsTotal), formatIDR(r.grossProfit)])}
        />
      );
    }
  }
}
