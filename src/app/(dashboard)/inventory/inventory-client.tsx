"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, inputClassName, selectClassName, textareaClassName } from "@/components/ui/form-field";
import { createManualAdjustmentAction, submitStockCountAction, type InventoryActionState } from "./actions";

type BaseUnit = "gram" | "millilitre" | "piece";

interface IngredientRow {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  currentQuantityBaseUnits: string;
  reorderLevelBaseUnits: string | null;
}

interface MovementRow {
  id: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  movementType: string;
  quantityBaseUnits: string;
  totalCost: number | null;
  sourceType: string;
  reason: string | null;
  createdAt: string | Date;
}

const UNIT_LABEL: Record<BaseUnit, string> = { gram: "g", millilitre: "ml", piece: "pc" };

function formatQty(value: string, unit: BaseUnit) {
  return `${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${UNIT_LABEL[unit]}`;
}

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const MOVEMENT_LABEL: Record<string, string> = {
  PURCHASE_RECEIPT: "Purchase",
  SALE_CONSUMPTION: "Sale",
  WASTE: "Waste",
  MANUAL_ADJUSTMENT_IN: "Adjustment (in)",
  MANUAL_ADJUSTMENT_OUT: "Adjustment (out)",
  STOCK_COUNT_CORRECTION: "Stock count",
  ORDER_CANCELLATION_REVERSAL: "Cancellation reversal",
  REFUND_REVERSAL: "Refund reversal",
  OPENING_BALANCE: "Opening balance",
};

type Tab = "low_stock" | "ledger" | "adjust" | "count";

export function InventoryClient({
  ingredients,
  movements,
  canAdjust,
}: {
  ingredients: IngredientRow[];
  movements: MovementRow[];
  canAdjust: boolean;
}) {
  const [tab, setTab] = useState<Tab>("low_stock");

  const lowStock = useMemo(
    () =>
      ingredients.filter(
        (i) => i.reorderLevelBaseUnits && Number(i.currentQuantityBaseUnits) <= Number(i.reorderLevelBaseUnits),
      ),
    [ingredients],
  );

  const tabs: Array<[Tab, string]> = [
    ["low_stock", `Low stock${lowStock.length ? ` (${lowStock.length})` : ""}`],
    ["ledger", "Ledger"],
    ...(canAdjust ? ([["adjust", "Adjust stock"], ["count", "Stock count"]] as Array<[Tab, string]>) : []),
  ];

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-[var(--color-border)]">
        {tabs.map(([value, label]) => (
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

      {tab === "low_stock" ? <LowStockTab rows={lowStock} /> : null}
      {tab === "ledger" ? <LedgerTab movements={movements} /> : null}
      {tab === "adjust" && canAdjust ? <AdjustTab ingredients={ingredients} /> : null}
      {tab === "count" && canAdjust ? <StockCountTab ingredients={ingredients} /> : null}
    </div>
  );
}

function LowStockTab({ rows }: { rows: IngredientRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
        Nothing below its reorder level.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-4 py-3">Ingredient</th>
            <th className="px-4 py-3 text-right">Current stock</th>
            <th className="px-4 py-3 text-right">Reorder level</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-[var(--color-border)] last:border-0">
              <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{i.name}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                <Badge tone="warning">{formatQty(i.currentQuantityBaseUnits, i.baseUnit)}</Badge>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                {formatQty(i.reorderLevelBaseUnits!, i.baseUnit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerTab({ movements }: { movements: MovementRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-4 py-3">When</th>
            <th className="px-4 py-3">Ingredient</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3 text-right">Quantity</th>
            <th className="px-4 py-3 text-right">Value</th>
            <th className="px-4 py-3">Reason</th>
          </tr>
        </thead>
        <tbody>
          {movements.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                No movements yet.
              </td>
            </tr>
          ) : (
            movements.map((m) => {
              const qty = Number(m.quantityBaseUnits);
              return (
                <tr key={m.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">{formatDate(m.createdAt)}</td>
                  <td className="px-4 py-3 text-[var(--color-text-primary)]">{m.ingredientName}</td>
                  <td className="px-4 py-3">
                    <Badge tone={qty >= 0 ? "success" : "danger"}>{MOVEMENT_LABEL[m.movementType] ?? m.movementType}</Badge>
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${qty >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                    {qty >= 0 ? "+" : ""}
                    {formatQty(m.quantityBaseUnits, m.baseUnit)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                    {m.totalCost !== null ? `Rp${m.totalCost.toLocaleString("id-ID")}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{m.reason ?? "—"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function AdjustTab({ ingredients }: { ingredients: IngredientRow[] }) {
  const [state, formAction, isPending] = useActionState<InventoryActionState, FormData>(
    createManualAdjustmentAction,
    undefined,
  );
  const errorState = state && !state.ok ? state : undefined;
  const justSaved = state?.ok === true;

  return (
    <div className="max-w-md">
      <form action={formAction} className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <Field label="Ingredient" htmlFor="ingredientId" error={errorState?.fieldErrors?.ingredientId}>
          <select id="ingredientId" name="ingredientId" required className={selectClassName}>
            <option value="">Select ingredient…</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({formatQty(i.currentQuantityBaseUnits, i.baseUnit)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Direction" htmlFor="direction">
          <select id="direction" name="direction" className={selectClassName}>
            <option value="in">Increase stock (in)</option>
            <option value="out">Decrease stock (out)</option>
          </select>
        </Field>
        <Field label="Quantity" htmlFor="quantityBaseUnits" hint="In the ingredient's base unit" error={errorState?.fieldErrors?.quantityBaseUnits}>
          <input id="quantityBaseUnits" name="quantityBaseUnits" type="number" min={0} step="any" required className={inputClassName} />
        </Field>
        <Field label="Reason" htmlFor="reason" error={errorState?.fieldErrors?.reason}>
          <input id="reason" name="reason" required placeholder="e.g. Correcting count error" className={inputClassName} />
        </Field>
        <Field label="Notes" htmlFor="notes">
          <textarea id="notes" name="notes" className={textareaClassName} />
        </Field>

        {errorState?.error ? (
          <p role="alert" className="rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
            {errorState.error}
          </p>
        ) : null}
        {justSaved ? (
          <p role="status" className="rounded-[var(--radius-sm)] bg-[#E7F8EF] px-3 py-2 text-sm text-[var(--color-success)]">
            Adjustment recorded.
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Record adjustment"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function StockCountTab({ ingredients }: { ingredients: IngredientRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const selectedIngredients = ingredients.filter((i) => selected.has(i.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setIsPending(true);
    setResult(null);
    const lines = selectedIngredients
      .filter((i) => counts[i.id] !== undefined && counts[i.id] !== "")
      .map((i) => ({ ingredientId: i.id, countedQuantity: Number(counts[i.id]) }));

    const res = await submitStockCountAction({ lines });
    setIsPending(false);
    if (res?.ok) {
      setResult({ ok: true, text: "Stock count submitted." });
      setReviewing(false);
      setSelected(new Set());
      setCounts({});
    } else {
      setResult({ ok: false, text: res?.error ?? "Something went wrong." });
    }
  }

  if (reviewing) {
    return (
      <div className="max-w-xl">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Review adjustments</h3>
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">Ingredient</th>
                <th className="px-4 py-3 text-right">System</th>
                <th className="px-4 py-3 text-right">Counted</th>
                <th className="px-4 py-3 text-right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {selectedIngredients.map((i) => {
                const counted = Number(counts[i.id] || 0);
                const system = Number(i.currentQuantityBaseUnits);
                const diff = counted - system;
                return (
                  <tr key={i.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{i.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-secondary)]">
                      {formatQty(i.currentQuantityBaseUnits, i.baseUnit)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatQty(String(counted), i.baseUnit)}</td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        diff === 0 ? "text-[var(--color-text-muted)]" : diff > 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                      }`}
                    >
                      {diff > 0 ? "+" : ""}
                      {formatQty(String(diff), i.baseUnit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {result && !result.ok ? (
          <p role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
            {result.text}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReviewing(false)}>
            Back
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Submitting…" : "Confirm & submit count"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
        Select ingredients to count, enter the physical quantity for each, then review before submitting.
      </p>
      {result?.ok ? (
        <p role="status" className="mb-3 rounded-[var(--radius-sm)] bg-[#E7F8EF] px-3 py-2 text-sm text-[var(--color-success)]">
          {result.text}
        </p>
      ) : null}
      <div className="flex flex-col divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {ingredients.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-2.5">
            <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
            <span className="flex-1 text-sm text-[var(--color-text-primary)]">{i.name}</span>
            <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
              system: {formatQty(i.currentQuantityBaseUnits, i.baseUnit)}
            </span>
            <input
              type="number"
              min={0}
              step="any"
              disabled={!selected.has(i.id)}
              value={counts[i.id] ?? ""}
              onChange={(e) => setCounts((prev) => ({ ...prev, [i.id]: e.target.value }))}
              placeholder="counted"
              className={inputClassName + " w-28"}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button disabled={selected.size === 0} onClick={() => setReviewing(true)}>
          Review count
        </Button>
      </div>
    </div>
  );
}
