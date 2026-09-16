"use client";

import { formatIDR } from "@/lib/money/money";
import { useEffect, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName, textareaClassName } from "@/components/ui/form-styles";
import { createWasteRecordAction, type WasteActionState } from "./actions";
import { useActionResultToast } from "@/components/ui/use-action-toast";

type BaseUnit = "gram" | "millilitre" | "piece";

interface IngredientOption {
  id: string;
  name: string;
  baseUnit: BaseUnit;
}

interface WasteRow {
  id: string;
  ingredientName: string;
  baseUnit: BaseUnit;
  quantityBaseUnits: string;
  reason: string;
  estimatedCost: number;
  notes: string | null;
  createdAt: string | Date;
}

const UNIT_LABEL: Record<BaseUnit, string> = { gram: "g", millilitre: "ml", piece: "pc" };
const REASON_LABEL: Record<string, string> = {
  expired: "Expired",
  spilled: "Spilled",
  damaged: "Damaged",
  preparation_waste: "Preparation waste",
  incorrect_preparation: "Incorrect preparation",
  other: "Other",
};

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
}

export function WasteClient({
  ingredients,
  records,
  pagination,
}: {
  ingredients: IngredientOption[];
  /** One server-fetched page of waste history. */
  records: WasteRow[];
  pagination?: ReactNode;
}) {
  const [recording, setRecording] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Waste</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Record spoilage and preparation waste. Estimated cost uses each ingredient&apos;s current average cost.
          </p>
        </div>
        <Button onClick={() => setRecording(true)}>
          <Plus size={16} />
          Record waste
        </Button>
      </div>

      <Modal open={recording} onClose={() => setRecording(false)} title="Record waste">
        <RecordWasteForm ingredients={ingredients} onDone={() => setRecording(false)} />
      </Modal>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">History</h2>
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Ingredient</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                    No waste recorded yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{r.ingredientName}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {Number(r.quantityBaseUnits).toLocaleString("id-ID")} {UNIT_LABEL[r.baseUnit]}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{REASON_LABEL[r.reason] ?? r.reason}</td>
                    <td className="px-4 py-3 tabular-nums">{formatIDR(r.estimatedCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          {pagination}
        </div>
      </div>
    </div>
  );
}

function RecordWasteForm({ ingredients, onDone }: { ingredients: IngredientOption[]; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<WasteActionState, FormData>(createWasteRecordAction, undefined);
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Waste recorded.");

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Ingredient" htmlFor="ingredientId" error={errorState?.fieldErrors?.ingredientId}>
          <Select id="ingredientId" name="ingredientId" required>
            <option value="">Select ingredient…</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity" htmlFor="quantityBaseUnits" hint="In the ingredient's base unit" error={errorState?.fieldErrors?.quantityBaseUnits}>
          <input id="quantityBaseUnits" name="quantityBaseUnits" type="number" min={0} step="any" required className={inputClassName} />
        </Field>
      </div>
      <Field label="Reason" htmlFor="reason" error={errorState?.fieldErrors?.reason}>
        <Select id="reason" name="reason" required>
          {Object.entries(REASON_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="notes">
        <textarea id="notes" name="notes" className={textareaClassName} />
      </Field>

      <div className="flex flex-col gap-3">
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
            {isPending ? "Recording…" : "Record waste"}
          </Button>
        </div>
      </div>
    </form>
  );
}
