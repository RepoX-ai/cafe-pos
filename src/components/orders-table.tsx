"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/badge";

export interface OrderRow {
  id: string;
  orderNumber: string;
  placed: string;
  orderType: string;
  tableLabel: string;
  items: Array<{ name: string; quantity: number }>;
  totalFormatted: string;
  paymentMethod: string;
  status: string;
  statusTone: BadgeTone;
}

/** Item lines shown inline before the column collapses into "+N more". */
const MAX_VISIBLE_ITEMS = 3;

function formatItem(item: { name: string; quantity: number }) {
  return `${item.quantity}× ${item.name}`;
}

/**
 * Whole-row click target for the orders list — not just the order-number
 * link. Renders one server-fetched page; `pagination` is the footer for it.
 */
export function OrdersTable({
  orders,
  basePath = "/orders",
  pagination,
}: {
  orders: OrderRow[];
  basePath?: "/orders" | "/pos/orders";
  pagination?: ReactNode;
}) {
  const router = useRouter();

  if (orders.length === 0) {
    return (
      <div>
        <p className="px-4 py-10 text-center text-[var(--color-text-secondary)] sm:hidden">No orders found.</p>
        <table className="hidden w-full min-w-[880px] border-collapse text-sm sm:table">
          <tbody>
            <tr>
              <td className="px-4 py-10 text-center text-[var(--color-text-secondary)]">No orders found.</td>
            </tr>
          </tbody>
        </table>
        {pagination}
      </div>
    );
  }

  return (
    <div>
      <table className="w-full min-w-[880px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="whitespace-nowrap px-4 py-3">Order #</th>
            <th className="whitespace-nowrap px-4 py-3">Placed</th>
            <th className="whitespace-nowrap px-4 py-3">Type</th>
            <th className="whitespace-nowrap px-4 py-3">Table</th>
            <th className="px-4 py-3">Items</th>
            <th className="w-[1%] whitespace-nowrap px-3 py-3">Total</th>
            <th className="whitespace-nowrap px-4 py-3">Payment</th>
            <th className="whitespace-nowrap px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              onClick={() => router.push(`${basePath}/${o.id}`)}
              className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-page-bg)]"
            >
              <td className="whitespace-nowrap px-4 py-3">
                <Link
                  href={`${basePath}/${o.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-medium text-[var(--color-accent-primary)] hover:underline"
                >
                  {o.orderNumber}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{o.placed}</td>
              <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{o.orderType}</td>
              <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{o.tableLabel}</td>
              <td className="w-full max-w-0 px-4 py-3">
                {o.items.length === 0 ? (
                  <span className="text-[var(--color-text-secondary)]">&mdash;</span>
                ) : (
                  <div className="flex items-baseline gap-1.5" title={o.items.map(formatItem).join(", ")}>
                    <span className="truncate text-[var(--color-text-secondary)]">
                      {o.items.slice(0, MAX_VISIBLE_ITEMS).map(formatItem).join(", ")}
                    </span>
                    {o.items.length > MAX_VISIBLE_ITEMS ? (
                      <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                        +{o.items.length - MAX_VISIBLE_ITEMS} more
                      </span>
                    ) : null}
                  </div>
                )}
              </td>
              <td className="w-[1%] whitespace-nowrap px-3 py-3 tabular-nums">{o.totalFormatted}</td>
              <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-secondary)]">{o.paymentMethod}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <Badge tone={o.statusTone}>{o.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pagination}
    </div>
  );
}
