"use client";

import { formatDisplayDateTime } from "@/lib/dates/dates";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { ClipboardList, Minus, Plus, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName, textareaClassName } from "@/components/ui/form-styles";
import { formatIDR } from "@/lib/money/money";
import {
  displayToBaseQuantity,
  formatDisplayQuantity,
  resolveDisplayUnit,
  type DisplayUnit,
} from "@/lib/units/units";
import { createManualAdjustmentAction, submitStockCountAction, type InventoryActionState } from "./actions";
import { useSubmissionKey } from "@/components/ui/use-submission-key";
import { useToast } from "@/components/ui/toast";
import { useActionResultToast } from "@/components/ui/use-action-toast";

type BaseUnit = "gram" | "millilitre" | "piece";

interface IngredientRow {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  displayUnit: DisplayUnit | null;
  currentQuantityBaseUnits: string;
  reorderLevelBaseUnits: string | null;
}

interface MovementRow {
  id: string;
  /** Null once the ingredient has been deleted; the name below is then the snapshot. */
  ingredientId: string | null;
  ingredientName: string;
  baseUnit: BaseUnit;
  displayUnit: DisplayUnit | null;
  movementType: string;
  quantityBaseUnits: string;
  totalCost: number | null;
  sourceType: string;
  reason: string | null;
  createdAt: string | Date;
  source: { kind: "order" | "purchase"; sourceId: string; label: string; reference: string | null } | null;
}

/** A base-unit quantity in the ingredient's chosen display unit (kg, L…). */
function formatQty(value: string, row: { baseUnit: BaseUnit; displayUnit: DisplayUnit | null }) {
  return formatDisplayQuantity(value, resolveDisplayUnit(row.baseUnit, row.displayUnit));
}

/** A typed display-unit amount as a base-unit string, or "" when blank or not a number. */
function toBaseOrBlank(value: string, unit: DisplayUnit): string {
  if (value.trim() === "") return "";
  try {
    return displayToBaseQuantity(value, unit);
  } catch {
    return "";
  }
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

export function InventoryClient({
  ingredients,
  movements,
  canAdjust,
  canViewOrders,
  canViewPurchases,
  ledgerPagination,
}: {
  ingredients: IngredientRow[];
  /** One server-fetched page of the ledger. */
  movements: MovementRow[];
  canAdjust: boolean;
  canViewOrders: boolean;
  canViewPurchases: boolean;
  ledgerPagination?: ReactNode;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const [counting, setCounting] = useState(false);

  const lowStock = useMemo(
    () =>
      ingredients.filter(
        (i) => i.reorderLevelBaseUnits && Number(i.currentQuantityBaseUnits) <= Number(i.reorderLevelBaseUnits),
      ),
    [ingredients],
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Inventory</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Stock levels, the movement ledger, adjustments, and stock counts.
          </p>
        </div>
        {canAdjust ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setCounting(true)}>
              <ClipboardList size={16} />
              Stock count
            </Button>
            <Button onClick={() => setAdjusting(true)}>
              <SlidersHorizontal size={16} />
              Adjust stock
            </Button>
          </div>
        ) : null}
      </div>

      {canAdjust ? (
        <Modal open={adjusting} onClose={() => setAdjusting(false)} title="Adjust stock">
          <AdjustStockForm ingredients={ingredients} onDone={() => setAdjusting(false)} />
        </Modal>
      ) : null}

      {canAdjust ? (
        <Modal
          open={counting}
          onClose={() => setCounting(false)}
          title="Stock count"
          maxWidthClassName="max-w-[640px]"
        >
          <StockCountFlow ingredients={ingredients} onDone={() => setCounting(false)} />
        </Modal>
      ) : null}

      <LowStockStrip rows={lowStock} />

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Ledger</h2>
        <LedgerTab movements={movements} canViewOrders={canViewOrders} canViewPurchases={canViewPurchases} pagination={ledgerPagination} />
      </div>
    </div>
  );
}

const LOW_STOCK_PREVIEW = 4;

/** Only rendered when something is at or below its reorder level. */
function LowStockStrip({ rows }: { rows: IngredientRow[] }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const visible = expanded ? rows : rows.slice(0, LOW_STOCK_PREVIEW);
  const hidden = rows.length - visible.length;

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-4 py-3 sm:flex-row sm:items-center"
    >
      <div className="flex shrink-0 items-center gap-2 text-sm font-medium text-[var(--color-warning)]">
        <TriangleAlert size={16} aria-hidden="true" />
        {rows.length} {rows.length === 1 ? "ingredient" : "ingredients"} at or below reorder level
      </div>
      <ul className="flex flex-wrap items-center gap-2">
        {visible.map((i) => (
          <li
            key={i.id}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text-primary)]"
          >
            {i.name}{" "}
            <span className="tabular-nums text-[var(--color-text-muted)]">
              {formatQty(i.currentQuantityBaseUnits, i)} / {formatQty(i.reorderLevelBaseUnits!, i)}
            </span>
          </li>
        ))}
        {rows.length > LOW_STOCK_PREVIEW ? (
          <li>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-medium text-[var(--color-accent-primary)] hover:underline"
            >
              {expanded ? "Show less" : `+${hidden} more`}
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function MovementSourceCell({
  source,
  canViewOrders,
  canViewPurchases,
}: {
  source: MovementRow["source"];
  canViewOrders: boolean;
  canViewPurchases: boolean;
}) {
  if (!source) return <span className="text-[var(--color-text-muted)]">—</span>;
  const href =
    source.kind === "order" && canViewOrders
      ? `/orders/${source.sourceId}`
      : source.kind === "purchase" && canViewPurchases
        ? `/purchases/${source.sourceId}`
        : null;
  return (
    <div className="flex flex-col">
      <span className="text-[var(--color-text-primary)]">{source.label}</span>
      {source.reference ? (
        href ? (
          <Link href={href} className="text-xs text-[var(--color-accent-primary)] hover:underline">
            {source.reference}
          </Link>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">{source.reference}</span>
        )
      ) : null}
    </div>
  );
}

function LedgerTab({
  movements,
  canViewOrders,
  canViewPurchases,
  pagination,
}: {
  movements: MovementRow[];
  canViewOrders: boolean;
  canViewPurchases: boolean;
  pagination?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="whitespace-nowrap px-4 py-3">When</th>
            <th className="px-4 py-3">Ingredient</th>
            <th className="whitespace-nowrap px-4 py-3">Type</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Quantity</th>
            <th className="px-4 py-3">Value</th>
            <th className="px-4 py-3">Reason</th>
          </tr>
        </thead>
        <tbody>
          {movements.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                No movements yet.
              </td>
            </tr>
          ) : (
            movements.map((m) => {
              const qty = Number(m.quantityBaseUnits);
              return (
                <tr key={m.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--color-text-muted)]">{formatDisplayDateTime(m.createdAt)}</td>
                  <td className="px-4 py-3 text-[var(--color-text-primary)]">{m.ingredientName}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={qty >= 0 ? "success" : "danger"}>{MOVEMENT_LABEL[m.movementType] ?? m.movementType}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <MovementSourceCell source={m.source} canViewOrders={canViewOrders} canViewPurchases={canViewPurchases} />
                  </td>
                  <td className={`px-4 py-3 tabular-nums ${qty >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>
                    {qty >= 0 ? "+" : ""}
                    {formatQty(m.quantityBaseUnits, m)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">
                    {m.totalCost !== null ? formatIDR(m.totalCost) : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{m.reason ?? "—"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      </div>
      {pagination}
    </div>
  );
}

function AdjustStockForm({ ingredients, onDone }: { ingredients: IngredientRow[]; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<InventoryActionState, FormData>(
    createManualAdjustmentAction,
    undefined,
  );
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Adjustment recorded.");
  // A new key once a response arrives; kept across a retry that got none.
  const [submissionKey, rotateSubmissionKey] = useSubmissionKey();
  useEffect(() => {
    if (state) rotateSubmissionKey();
  }, [state, rotateSubmissionKey]);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const selectedIngredient = ingredients.find((i) => i.id === ingredientId);
  const unit = selectedIngredient ? resolveDisplayUnit(selectedIngredient.baseUnit, selectedIngredient.displayUnit) : null;

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={submissionKey} />
      <input type="hidden" name="direction" value={direction} />
      <div
        role="group"
        aria-label="Direction"
        className="flex gap-1 rounded-[var(--radius-sm)] bg-[var(--color-page-bg)] p-1"
      >
        {(
          [
            ["in", "Increase stock", Plus, "text-[var(--color-success)]"],
            ["out", "Decrease stock", Minus, "text-[var(--color-danger)]"],
          ] as const
        ).map(([value, label, Icon, activeTone]) => (
          <button
            key={value}
            type="button"
            aria-pressed={direction === value}
            onClick={() => setDirection(value)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-[calc(var(--radius-sm)-2px)] px-3 py-2 text-sm font-medium transition-colors ${
              direction === value
                ? `bg-[var(--color-surface)] shadow-sm ${activeTone}`
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <Field label="Ingredient" htmlFor="ingredientId" error={errorState?.fieldErrors?.ingredientId}>
        <Select id="ingredientId" name="ingredientId" required value={ingredientId} onChange={setIngredientId}>
          <option value="">Select ingredient…</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({formatQty(i.currentQuantityBaseUnits, i)})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Quantity" htmlFor="quantityBaseUnits" error={errorState?.fieldErrors?.quantityBaseUnits}>
        <QuantityInput unit={unit} value={quantity} onChange={setQuantity} />
      </Field>
      <Field label="Reason" htmlFor="reason" error={errorState?.fieldErrors?.reason}>
        <input id="reason" name="reason" required placeholder="e.g. Correcting count error" className={inputClassName} />
      </Field>
      <Field label="Notes" htmlFor="notes">
        <textarea id="notes" name="notes" className={textareaClassName} />
      </Field>

      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState.error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Record adjustment"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Number input with the ingredient's display unit fixed to its right edge.
 * The typed amount is in that unit (2,5 kg); the hidden input submits it in
 * base units (2500 g), which is what the action and the ledger work in.
 */
function QuantityInput({
  unit,
  value,
  onChange,
}: {
  unit: DisplayUnit | null;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <div className="relative">
        <input
          id="quantityBaseUnits"
          type="number"
          min={0}
          step="any"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClassName} w-full pr-12`}
        />
        {unit ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[var(--color-text-muted)]">
            {unit}
          </span>
        ) : null}
      </div>
      <input type="hidden" name="quantityBaseUnits" value={unit ? toBaseOrBlank(value, unit) : ""} />
    </>
  );
}

function StockCountFlow({ ingredients, onDone }: { ingredients: IngredientRow[]; onDone: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const showToast = useToast();

  const selectedIngredients = ingredients.filter((i) => selected.has(i.id));
  // Counts are typed in each ingredient's display unit; everything compared
  // or submitted is in base units.
  const countedBase = (i: IngredientRow) =>
    toBaseOrBlank(counts[i.id] ?? "", resolveDisplayUnit(i.baseUnit, i.displayUnit)) || "0";

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [countSubmissionKey, rotateCountSubmissionKey] = useSubmissionKey();

  async function submit() {
    setIsPending(true);
    setResult(null);
    const lines = selectedIngredients
      .filter((i) => counts[i.id] !== undefined && counts[i.id] !== "")
      .map((i) => ({ ingredientId: i.id, countedQuantity: Number(countedBase(i)) }));

    let res: Awaited<ReturnType<typeof submitStockCountAction>>;
    try {
      res = await submitStockCountAction({ lines, idempotencyKey: countSubmissionKey });
    } catch {
      // No response: the count may or may not have been saved; the retry reuses the key.
      setIsPending(false);
      const text = "Couldn't reach the server. Check the connection and submit again — it won't be recorded twice.";
      setResult({ ok: false, text });
      showToast("error", text);
      return;
    }
    rotateCountSubmissionKey();
    setIsPending(false);
    if (res?.ok) {
      showToast("success", "Stock count submitted.");
      setResult(null);
      setReviewing(false);
      setSelected(new Set());
      setCounts({});
      onDone();
    } else {
      const text = res?.error ?? "Something went wrong.";
      setResult({ ok: false, text });
      showToast("error", text);
    }
  }

  if (reviewing) {
    return (
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Review adjustments</h3>
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">Ingredient</th>
                <th className="px-4 py-3">System</th>
                <th className="px-4 py-3">Counted</th>
                <th className="px-4 py-3">Difference</th>
              </tr>
            </thead>
            <tbody>
              {selectedIngredients.map((i) => {
                const counted = countedBase(i);
                const system = Number(i.currentQuantityBaseUnits);
                const diff = Number(counted) - system;
                return (
                  <tr key={i.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{i.name}</td>
                    <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">
                      {formatQty(i.currentQuantityBaseUnits, i)}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{formatQty(counted, i)}</td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        diff === 0 ? "text-[var(--color-text-muted)]" : diff > 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                      }`}
                    >
                      {diff > 0 ? "+" : ""}
                      {formatQty(diff.toFixed(4), i)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {result && !result.ok ? (
          <p role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
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
    <div>
      <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
        Select ingredients to count, enter the physical quantity for each, then review before submitting.
      </p>
      <div className="flex max-h-[50vh] flex-col divide-y divide-[var(--color-border)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {ingredients.map((i) => (
          <div key={i.id} className="flex items-center gap-3 px-4 py-2.5">
            <Checkbox checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
            <span className="flex-1 text-sm text-[var(--color-text-primary)]">{i.name}</span>
            <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
              system: {formatQty(i.currentQuantityBaseUnits, i)}
            </span>
            <input
              type="number"
              min={0}
              step="any"
              disabled={!selected.has(i.id)}
              value={counts[i.id] ?? ""}
              onChange={(e) => setCounts((prev) => ({ ...prev, [i.id]: e.target.value }))}
              placeholder={`counted (${resolveDisplayUnit(i.baseUnit, i.displayUnit)})`}
              className={inputClassName + " w-28"}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={selected.size === 0} onClick={() => setReviewing(true)}>
          Review count
        </Button>
      </div>
    </div>
  );
}
