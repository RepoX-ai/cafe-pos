"use client";

import { formatIDR } from "@/lib/money/money";
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { PurchaseRow } from "./purchase-types";

export function HistoryTab({ purchases, pagination }: { purchases: PurchaseRow[]; pagination?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Supplier</th>
            <th className="px-4 py-3">Invoice</th>
            <th className="px-4 py-3">Stock</th>
            <th className="px-4 py-3">Payment</th>
            <th className="px-4 py-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {purchases.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                No purchases recorded yet.
              </td>
            </tr>
          ) : (
            purchases.map((p) => (
              <tr key={p.id} className="relative border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-page-bg)]">
                <td className="relative px-4 py-3 text-[var(--color-text-secondary)]">
                  <Link href={`/purchases/${p.id}`} className="absolute inset-0" aria-label={`View purchase ${p.invoiceNumber ?? p.purchaseDate}`} />
                  {p.purchaseDate}
                </td>
                <td className="px-4 py-3 text-[var(--color-text-primary)]">{p.supplierName ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{p.invoiceNumber ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={p.status === "FINALIZED" ? "success" : "neutral"}>{p.status}</Badge>
                </td>
                <td className="px-4 py-3"><Badge tone={p.paidAt ? "success" : "warning"}>{p.paidAt ? `Paid ${p.paidAt}` : "Unconfirmed"}</Badge></td>
                <td className="px-4 py-3 tabular-nums">{formatIDR(p.totalCost)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      {pagination}
    </div>
  );
}
