import { formatIDR } from "@/lib/money/money";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { listOrders } from "@/server/services/order-service";
import type { BadgeTone } from "@/components/ui/badge";
import { Select } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { Button } from "@/components/ui/button";
import { OrdersTable } from "@/components/orders-table";

export const metadata: Metadata = {
  title: "Order history — CaféOps",
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

/**
 * Cashier-facing order history, reachable from the POS (not the admin
 * dashboard — cashier-only users are hard-redirected out of that layout
 * per PRD §10). Anyone holding orders:read_all_basic can browse every
 * order to help resolve a customer complaint, but this page and its
 * detail view never render COGS/gross-profit/margin — that stays behind
 * orders:read_all on the admin /orders pages.
 */
export default async function PosOrderHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const user = await requirePageAccess();
  if (!hasAnyRolePermission(user.roles, "orders:read_all_basic") && !hasAnyRolePermission(user.roles, "orders:read_all")) {
    redirect("/forbidden");
  }
  const { status, search } = await searchParams;

  const orders = await listOrders(db, user.businessId, { status: status || undefined, search: search || undefined });

  return (
    <div className="force-light-theme min-h-screen bg-[var(--color-page-bg)] px-6 py-6">
      <div className="mx-auto max-w-[1200px]">
        <Link href="/pos" className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          &larr; Back to POS
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">Order history</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">All submitted orders for this café.</p>

        <form className="mt-6 flex flex-wrap items-end gap-3" action="/pos/orders">
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
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              {["SUBMITTED", "PRINT_PENDING", "PRINTED", "COMPLETED", "CANCELLED", "REFUNDED"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        <div className="mt-6 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <OrdersTable
            basePath="/pos/orders"
            orders={orders.map((o) => ({
              id: o.id,
              orderNumber: o.orderNumber,
              placed: formatDate(o.createdAt),
              orderType: o.orderType,
              tableLabel: o.tableLabel ?? "—",
              totalFormatted: formatIDR(o.total),
              status: o.status,
              statusTone: STATUS_TONE[o.status] ?? "neutral",
            }))}
          />
        </div>
      </div>
    </div>
  );
}
