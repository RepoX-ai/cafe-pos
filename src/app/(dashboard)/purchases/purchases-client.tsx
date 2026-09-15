"use client";

import { useState, type ReactNode } from "react";
import { NewReceiptTab } from "./new-receipt-tab";
import { HistoryTab } from "./purchase-history-tab";
import { SuppliersTab } from "./suppliers-tab";
import type { IngredientOption, PurchaseRow, SupplierRow } from "./purchase-types";

type Tab = "new" | "history" | "suppliers";

export function PurchasesClient({
  ingredients,
  suppliers,
  purchases,
  initialTab = "new",
  historyPagination,
}: {
  ingredients: IngredientOption[];
  suppliers: SupplierRow[];
  /** One server-fetched page of receipt history. */
  purchases: PurchaseRow[];
  initialTab?: Tab;
  historyPagination?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-[var(--color-border)]">
        {(
          [
            ["new", "New receipt"],
            ["history", "History"],
            ["suppliers", "Suppliers"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === value
                ? "border-[var(--color-accent-primary)] text-[var(--color-text-primary)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "new" ? (
        <NewReceiptTab ingredients={ingredients} suppliers={suppliers.filter((s) => s.active)} />
      ) : null}
      {tab === "history" ? <HistoryTab purchases={purchases} pagination={historyPagination} /> : null}
      {tab === "suppliers" ? <SuppliersTab suppliers={suppliers} /> : null}
    </div>
  );
}
