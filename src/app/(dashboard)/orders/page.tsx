import type { Metadata } from "next";
import Link from "next/link";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listOrders } from "@/server/services/order-service";
import { Badge } from "@/components/ui/badge";
import { inputClassName, selectClassName } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Orders — CaféOps",
};

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "accent"> = {
  SUBMITTED: "accent",
  PRINT_PENDING: "warning",
  PRINTED: "success",
  COMPLETED: "success",
  CANCELLED: "neutral",
  REFUNDED: "danger",
};

function formatIDR(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

function formatDate(value: Date) {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const user = await requirePageAccess("orders:read_all");
  const { status, search } = await searchParams;

  const orders = await listOrders(db, user.businessId, { status: status || undefined, search: search || undefined });

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
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
          <select id="status" name="status" defaultValue={status ?? ""} className={selectClassName}>
            <option value="">All statuses</option>
            {["SUBMITTED", "PRINT_PENDING", "PRINTED", "COMPLETED", "CANCELLED", "REFUNDED"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Order #</th>
              <th className="px-4 py-3">Placed</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Table</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                  No orders found.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium text-[var(--color-accent-primary)] hover:underline">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{formatDate(o.createdAt)}</td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{o.orderType}</td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{o.tableLabel ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatIDR(o.total)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>{o.status}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
