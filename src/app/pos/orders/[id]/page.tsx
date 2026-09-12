import { formatIDR } from "@/lib/money/money";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { getOrderById } from "@/server/services/order-service";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Order — CaféOps",
};

function formatDate(value: Date) {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
}

/**
 * Cashier-safe order detail (see page.tsx in the parent folder for why this
 * lives under /pos instead of the admin /orders route). Deliberately omits
 * every COGS/gross-profit/margin field and the inventory-consumption panel
 * that the admin order detail page shows — orders:read_all_basic must never
 * surface that data (PRD §4).
 */
export default async function PosOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess();
  if (!hasAnyRolePermission(user.roles, "orders:read_all_basic") && !hasAnyRolePermission(user.roles, "orders:read_all")) {
    redirect("/forbidden");
  }

  const detail = await getOrderById(db, user.businessId, id);
  if (!detail) notFound();

  const { order, lines } = detail;

  return (
    <div className="force-light-theme min-h-screen bg-[var(--color-page-bg)] px-6 py-6">
      <div className="mx-auto max-w-[900px]">
        <Link href="/pos/orders" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <ArrowLeft size={14} />
          Back to order history
        </Link>

        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{order.orderNumber}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {formatDate(order.createdAt)} · {order.orderType} {order.tableLabel ? `· ${order.tableLabel}` : ""}
            </p>
          </div>
          <Badge tone={order.status === "CANCELLED" ? "neutral" : order.status === "REFUNDED" ? "danger" : "success"}>
            {order.status}
          </Badge>
        </div>

        {order.status === "CANCELLED" ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-page-bg)] p-3 text-sm text-[var(--color-text-secondary)]">
            Cancelled {order.cancelledAt ? formatDate(order.cancelledAt) : ""} — {order.cancellationReason}
          </div>
        ) : null}

        <section className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Unit price</th>
                <th className="px-4 py-3 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-[var(--color-border)] last:border-0 align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[var(--color-text-primary)]">
                      {line.itemNameSnapshot}
                      {line.variantNameSnapshot ? (
                        <span className="text-[var(--color-text-secondary)]"> · {line.variantNameSnapshot}</span>
                      ) : null}
                    </p>
                    {line.modifiers.length > 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)]">{line.modifiers.map((m) => m.modifierNameSnapshot).join(", ")}</p>
                    ) : null}
                    {line.notes ? <p className="text-xs italic text-[var(--color-text-muted)]">&quot;{line.notes}&quot;</p> : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatIDR(line.unitPriceSnapshot)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatIDR(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Subtotal" value={formatIDR(order.subtotal)} />
          <Metric label="Discount" value={formatIDR(order.discountTotal)} />
          <Metric label="Tax" value={formatIDR(order.taxTotal)} />
          <Metric label="Service charge" value={formatIDR(order.serviceChargeTotal)} />
          <Metric label="Total" value={formatIDR(order.total)} />
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums text-[var(--color-text-primary)]">{value}</p>
    </div>
  );
}
