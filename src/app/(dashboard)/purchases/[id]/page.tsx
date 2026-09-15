import { formatIDR, formatIDRRate } from "@/lib/money/money";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { getPurchaseWithLines } from "@/server/services/purchase-service";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Purchase — CaféOps",
};

type BaseUnit = "gram" | "millilitre" | "piece";

const UNIT_LABEL: Record<BaseUnit, string> = { gram: "g", millilitre: "ml", piece: "pc" };


function formatDateTime(value: Date) {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
}

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess("purchases:write");

  const detail = await getPurchaseWithLines(db, user.businessId, id);
  if (!detail) notFound();

  const { purchase, lines } = detail;

  return (
    <div className="mx-auto max-w-[1000px]">
      <Link href="/purchases" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
        <ArrowLeft size={14} />
        Back to purchases
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            {purchase.invoiceNumber || "Purchase receipt"}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {purchase.purchaseDate} · {purchase.supplierName ?? "No supplier"}
          </p>
        </div>
        <Badge tone={purchase.status === "FINALIZED" ? "success" : "neutral"}>{purchase.status}</Badge>
      </div>

      <section className="mt-6 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Ingredient</th>
              <th className="px-4 py-3 text-right">Qty purchased</th>
              <th className="px-4 py-3 text-right">→ base units</th>
              <th className="px-4 py-3 text-right">Cost / base unit</th>
              <th className="px-4 py-3 text-right">Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{line.ingredientName}</td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                  {Number(line.quantityPurchased).toLocaleString("id-ID", { maximumFractionDigits: 4 })} {line.purchaseUnit}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                  {Number(line.quantityBaseUnits).toLocaleString("id-ID", { maximumFractionDigits: 2 })}{" "}
                  {UNIT_LABEL[line.ingredientBaseUnit as BaseUnit]}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                  {formatIDRRate(line.costPerBaseUnit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatIDR(line.totalLineCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">Total cost</span>
        <span className="text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">{formatIDR(purchase.totalCost)}</span>
      </section>

      <p className="mt-4 text-xs text-[var(--color-text-muted)]">
        Recorded {formatDateTime(purchase.createdAt)}
        {purchase.finalizedAt ? ` · Finalized ${formatDateTime(purchase.finalizedAt)}` : ""}
      </p>
    </div>
  );
}
