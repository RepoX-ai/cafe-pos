import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { startOfBusinessDay, endOfBusinessDay, todayInBusinessTimezone, formatBusinessDateTime } from "@/lib/dates/dates";
import { Select } from "@/components/ui/form-field";
import { DatePicker } from "@/components/ui/date-picker";
import { Button, buttonVariants } from "@/components/ui/button";
import { listIngredients } from "@/server/services/ingredient-service";
import { listMovements } from "@/server/services/inventory-service";
import { listPurchases } from "@/server/services/purchase-service";
import { listWasteRecords } from "@/server/services/waste-service";
import {
  getCancelledRefundedOrders,
  getExpensesInRange,
  getSalesByCategory,
  getSalesByDay,
  getSalesByMenuItem,
  getSalesByPaymentMethod,
} from "@/server/services/reports-service";
import { ReportTable } from "./report-table";

export const metadata: Metadata = {
  title: "Reports — CaféOps",
};

const REPORT_TYPES = [
  { value: "sales_by_day", label: "Sales by day" },
  { value: "sales_by_menu_item", label: "Sales by menu item" },
  { value: "sales_by_category", label: "Sales by category" },
  { value: "sales_by_payment_method", label: "Sales by payment method" },
  { value: "cancelled_refunded", label: "Cancelled / refunded orders" },
  { value: "current_stock", label: "Current stock" },
  { value: "low_stock", label: "Low stock" },
  { value: "inventory_movements", label: "Inventory movements" },
  { value: "purchases", label: "Purchases" },
  { value: "waste", label: "Waste" },
  { value: "expenses", label: "Expenses" },
] as const;

function formatIDR(n: number) {
  return `Rp${Number(n).toLocaleString("id-ID")}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; from?: string; to?: string }>;
}) {
  const user = await requirePageAccess("reports:read");
  const { type = "sales_by_day", from, to } = await searchParams;

  const fromDate = from || todayInBusinessTimezone();
  const toDate = to || todayInBusinessTimezone();
  const range = { from: startOfBusinessDay(fromDate), to: endOfBusinessDay(toDate) };

  const table = await renderReportTable(user.businessId, type, range);

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
              <option key={t.value} value={t.value}>
                {t.label}
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

      <div className="mt-6">{table}</div>
    </div>
  );
}

async function renderReportTable(businessId: string, type: string, range: { from: Date; to: Date }) {
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
      const rows = await getCancelledRefundedOrders(db, businessId, range);
      return (
        <ReportTable
          columns={["Order #", "Status", "Total", "Reason", "Placed at"]}
          rows={rows.map((r) => [
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
          rows={rows.map((r) => [r.name, r.baseUnit, r.currentQuantityBaseUnits, formatIDR(Number(r.averageCostPerBaseUnit))])}
        />
      );
    }
    case "low_stock": {
      const all = await listIngredients(db, businessId);
      const rows = all.filter((i) => i.reorderLevelBaseUnits && Number(i.currentQuantityBaseUnits) <= Number(i.reorderLevelBaseUnits));
      return <ReportTable columns={["Ingredient", "Current qty", "Reorder level"]} rows={rows.map((r) => [r.name, r.currentQuantityBaseUnits, r.reorderLevelBaseUnits!])} />;
    }
    case "inventory_movements": {
      const rows = await listMovements(db, businessId, { limit: 500 });
      return (
        <ReportTable
          columns={["When", "Ingredient", "Type", "Quantity", "Value"]}
          rows={rows.map((r) => [formatBusinessDateTime(r.createdAt), r.ingredientName, r.movementType, r.quantityBaseUnits, r.totalCost !== null ? formatIDR(r.totalCost) : "—"])}
        />
      );
    }
    case "purchases": {
      const rows = await listPurchases(db, businessId);
      return (
        <ReportTable
          columns={["Date", "Supplier", "Invoice", "Status", "Total"]}
          rows={rows.map((r) => [r.purchaseDate, r.supplierName ?? "—", r.invoiceNumber ?? "—", r.status, formatIDR(r.totalCost)])}
        />
      );
    }
    case "waste": {
      const rows = await listWasteRecords(db, businessId);
      return (
        <ReportTable
          columns={["When", "Ingredient", "Quantity", "Reason", "Est. cost"]}
          rows={rows.map((r) => [formatBusinessDateTime(r.createdAt), r.ingredientName, r.quantityBaseUnits, r.reason, formatIDR(r.estimatedCost)])}
        />
      );
    }
    case "expenses": {
      const rows = await getExpensesInRange(db, businessId, range);
      return <ReportTable columns={["Date", "Category", "Payee", "Amount"]} rows={rows.map((r) => [r.expenseDate, r.category, r.payee ?? "—", formatIDR(r.amount)])} />;
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
