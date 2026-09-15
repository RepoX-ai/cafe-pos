import { formatIDR } from "@/lib/money/money";
import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { parsePageParam } from "@/lib/pagination";
import { ServerPagination } from "@/components/ui/server-pagination";
import { listOrders, listOrderItemSummaries } from "@/server/services/order-service";
import type { BadgeTone } from "@/components/ui/badge";
import { inputClassName } from "@/components/ui/form-styles";
import { OrdersTable } from "@/components/orders-table";
import { OrderStatusFilter } from "./order-status-filter";

export const metadata: Metadata = {
  title: "Orders — CaféOps",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  SUBMITTED: "accent",
  PRINT_PENDING: "warning",
  PRINTED: "success",
  COMPLETED: "success",
  CANCELLED: "neutral",
  REFUNDED: "danger",
};

function formatDate(value: Date) {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>;
}) {
  const user = await requirePageAccess("orders:read_all");
  const { status, search, page } = await searchParams;

  const result = await listOrders(db, user.businessId, {
    status: status || undefined,
    search: search || undefined,
    page: parsePageParam(page),
  });
  const orders = result.rows;
  const itemsByOrder = await listOrderItemSummaries(db, orders.map((o) => o.id));

  return (
    <div className="mx-auto max-w-[1440px]">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Orders</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">All submitted orders for this café.</p>

      <form className="mt-6 flex flex-wrap items-end gap-3" action="/orders">
        <div>
          <label htmlFor="search" className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
            Order number
          </label>
          <input id="search" name="search" defaultValue={search} placeholder="e.g. DEV-00012" className={inputClassName} />
        </div>
        <div>
          <label htmlFor="status" className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
            Status
          </label>
          <OrderStatusFilter status={status ?? ""} />
        </div>
      </form>

      <div className="mt-6 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <OrdersTable
          pagination={
            <ServerPagination page={{ ...result, rowCount: orders.length }} basePath="/orders" params={{ status, search }} />
          }
          orders={orders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            placed: formatDate(o.createdAt),
            orderType: o.orderType,
            tableLabel: o.tableLabel ?? "—",
            items: itemsByOrder.get(o.id) ?? [],
            totalFormatted: formatIDR(o.total),
            status: o.status,
            statusTone: STATUS_TONE[o.status] ?? "neutral",
          }))}
        />
      </div>
    </div>
  );
}
