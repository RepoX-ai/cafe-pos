"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { usePagination } from "@/components/ui/use-pagination";

export interface OrderRow {
  id: string;
  orderNumber: string;
  placed: string;
  orderType: string;
  tableLabel: string;
  totalFormatted: string;
  status: string;
  statusTone: BadgeTone;
}

/** Whole-row click target for the orders list — not just the order-number link. */
export function OrdersTable({ orders, basePath = "/orders" }: { orders: OrderRow[]; basePath?: "/orders" | "/pos/orders" }) {
  const router = useRouter();
  const { page, setPage, totalPages, pageItems, pageSize, totalItems } = usePagination(orders, 20);

  if (orders.length === 0) {
    return (
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <tbody>
          <tr>
            <td className="px-4 py-10 text-center text-[var(--color-text-secondary)]">No orders found.</td>
          </tr>
        </tbody>
      </table>
    );
  }

  return (
    <div>
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
          {pageItems.map((o) => (
            <tr
              key={o.id}
              onClick={() => router.push(`${basePath}/${o.id}`)}
              className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-page-bg)]"
            >
              <td className="px-4 py-3">
                <Link
                  href={`${basePath}/${o.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-medium text-[var(--color-accent-primary)] hover:underline"
                >
                  {o.orderNumber}
                </Link>
              </td>
              <td className="px-4 py-3 text-[var(--color-text-secondary)]">{o.placed}</td>
              <td className="px-4 py-3 text-[var(--color-text-secondary)]">{o.orderType}</td>
              <td className="px-4 py-3 text-[var(--color-text-secondary)]">{o.tableLabel}</td>
              <td className="px-4 py-3 text-right tabular-nums">{o.totalFormatted}</td>
              <td className="px-4 py-3">
                <Badge tone={o.statusTone}>{o.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}
