import { formatIDR } from "@/lib/money/money";
import { BASE_UNIT_LABEL, type BaseUnit } from "@/lib/units/units";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { formatDisplayDateTime } from "@/lib/dates/dates";
import { formatPaymentMethod } from "@/lib/orders/payment-method";
import { getOrderById } from "@/server/services/order-service";
import { recoverAbandonedPrintJobs } from "@/server/services/print-service";
import { configuredPrintProvider } from "@/printing";
import { Badge } from "@/components/ui/badge";
import { TotalsPanel, TotalsRow } from "@/components/order-totals";
import { OrderActionButton } from "./order-action-button";
import { PrintJobsPanel } from "./print-jobs-panel";

export const metadata: Metadata = {
  title: "Order — CaféOps",
};

/** Base-unit quantity with its unit — "125 g", not a bare "125". */
function formatBaseQuantity(value: string, unit: BaseUnit | null) {
  const amount = Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 });
  return unit ? `${amount} ${BASE_UNIT_LABEL[unit]}` : amount;
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess("orders:read_all");
  const canCancel = hasAnyRolePermission(user.roles, "orders:cancel");
  const canRefund = hasAnyRolePermission(user.roles, "orders:refund");
  const canManagePrinter = hasAnyRolePermission(user.roles, "printer:manage");
  const canReprint = hasAnyRolePermission(user.roles, "orders:reprint");

  const detail = await getOrderById(db, user.businessId, id);
  if (!detail) notFound();

  const { order, lines, printJobs } = detail;

  // Snapshot columns, not the current ingredient row: a deleted or renamed
  // ingredient still reports what was actually deducted at the time.
  const consumptionRows = lines.flatMap((line) =>
    line.consumption.map((c) => ({
      id: c.id,
      ingredientName: c.ingredientNameSnapshot ?? "Deleted ingredient",
      usedIn: line.variantNameSnapshot ? `${line.itemNameSnapshot} · ${line.variantNameSnapshot}` : line.itemNameSnapshot,
      quantity: formatBaseQuantity(c.quantityBaseUnits, c.ingredientBaseUnitSnapshot),
      totalCost: c.totalCost,
    })),
  );
  // A job abandoned mid-print already shows as "outcome unknown"; record that
  // on the job (FAILED, for a person to check) once the response is sent.
  if (printJobs.some((job) => job.outcomeUnknown)) {
    after(() => recoverAbandonedPrintJobs(db, user.businessId).catch(() => undefined));
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <Link href="/orders" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
        <ArrowLeft size={14} />
        Back to orders
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {formatDisplayDateTime(order.createdAt)} · {order.orderType} {order.tableLabel ? `· ${order.tableLabel}` : ""}
          </p>
        </div>
        <Badge tone={order.status === "CANCELLED" ? "neutral" : order.status === "REFUNDED" ? "danger" : "success"}>
          {order.status}
        </Badge>
      </div>

      {order.status === "CANCELLED" ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-page-bg)] p-3 text-sm text-[var(--color-text-secondary)]">
          Cancelled {order.cancelledAt ? formatDisplayDateTime(order.cancelledAt) : ""} — {order.cancellationReason}
        </div>
      ) : null}

      <section className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Line total</th>
              <th className="px-4 py-3">COGS</th>
              <th className="px-4 py-3">Gross profit</th>
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
                <td className="px-4 py-3 tabular-nums">{line.quantity}</td>
                <td className="px-4 py-3 tabular-nums">{formatIDR(line.unitPriceSnapshot)}</td>
                <td className="px-4 py-3 tabular-nums">{formatIDR(line.lineTotal)}</td>
                <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">{formatIDR(line.cogsSnapshot)}</td>
                <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">{formatIDR(line.grossProfitSnapshot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <TotalsPanel caption="Payment">
          <TotalsRow label="Subtotal" value={formatIDR(order.subtotal)} />
          <TotalsRow label="Discount" value={formatIDR(order.discountTotal)} muted />
          <TotalsRow label="Tax" value={formatIDR(order.taxTotal)} />
          <TotalsRow label="Service charge" value={formatIDR(order.serviceChargeTotal)} />
          <TotalsRow label="Total" value={formatIDR(order.total)} emphasis />
          <TotalsRow label="Payment method" value={formatPaymentMethod(order.paymentMethodLabel)} />
          {order.cashReceived !== null ? <TotalsRow label="Cash received" value={formatIDR(order.cashReceived)} /> : null}
          {order.changeDue !== null ? <TotalsRow label="Change" value={formatIDR(order.changeDue)} /> : null}
        </TotalsPanel>
        <TotalsPanel caption="Profitability">
          <TotalsRow label="Revenue (subtotal)" value={formatIDR(order.subtotal)} />
          <TotalsRow label="COGS" value={formatIDR(order.cogsTotal)} />
          <TotalsRow label="Gross profit" value={formatIDR(order.grossProfit)} emphasis />
          <TotalsRow
            label="Gross margin"
            value={order.grossMarginPercentage !== null ? `${Number(order.grossMarginPercentage).toFixed(1)}%` : "—"}
          />
        </TotalsPanel>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Inventory consumption</h2>
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">Ingredient</th>
                <th className="px-4 py-3">Used in</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {consumptionRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-[var(--color-text-secondary)]">
                    No ingredients were deducted for this order.
                  </td>
                </tr>
              ) : (
                consumptionRows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{row.ingredientName}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{row.usedIn}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.quantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatIDR(row.totalCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Print jobs</h2>
        <PrintJobsPanel
          orderId={order.id}
          printJobs={printJobs}
          canManagePrinter={canManagePrinter}
          canReprint={canReprint}
          orderCancelled={order.status === "CANCELLED"}
          devicePrinting={configuredPrintProvider() === "device"}
        />
      </section>

      {order.status !== "CANCELLED" && order.status !== "REFUNDED" ? (
        <div className="mt-8 flex gap-3">
          {canCancel ? <OrderActionButton orderId={order.id} kind="cancel" /> : null}
          {canRefund ? <OrderActionButton orderId={order.id} kind="refund" /> : null}
        </div>
      ) : null}
    </div>
  );
}
