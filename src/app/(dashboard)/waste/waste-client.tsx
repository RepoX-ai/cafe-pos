"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClassName, selectClassName, textareaClassName } from "@/components/ui/form-field";
import { createWasteRecordAction, type WasteActionState } from "./actions";

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

export function WasteClient({ ingredients, records }: { ingredients: IngredientOption[]; records: WasteRow[] }) {
  const [state, formAction, isPending] = useActionState<WasteActionState, FormData>(createWasteRecordAction, undefined);
  const errorState = state && !state.ok ? state : undefined;
  const justSaved = state?.ok === true;

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="grid grid-cols-2 gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <Field label="Ingredient" htmlFor="ingredientId" error={errorState?.fieldErrors?.ingredientId}>
          <select id="ingredientId" name="ingredientId" required className={selectClassName}>
            <option value="">Select ingredient…</option>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" htmlFor="quantityBaseUnits" hint="In the ingredient's base unit" error={errorState?.fieldErrors?.quantityBaseUnits}>
          <input id="quantityBaseUnits" name="quantityBaseUnits" type="number" min={0} step="any" required className={inputClassName} />
        </Field>
        <Field label="Reason" htmlFor="reason" error={errorState?.fieldErrors?.reason}>
          <select id="reason" name="reason" required className={selectClassName}>
            {Object.entries(REASON_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" htmlFor="notes">
          <textarea id="notes" name="notes" className={textareaClassName} />
        </Field>

        <div className="col-span-2 flex flex-col gap-3">
          {errorState?.error ? (
            <p role="alert" className="rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
              {errorState.error}
            </p>
          ) : null}
          {justSaved ? (
            <p role="status" className="rounded-[var(--radius-sm)] bg-[#E7F8EF] px-3 py-2 text-sm text-[var(--color-success)]">
              Waste recorded.
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording…" : "Record waste"}
            </Button>
          </div>
        </div>
      </form>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">History</h2>
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Ingredient</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-right">Est. cost</th>
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
                    <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{r.ingredientName}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Number(r.quantityBaseUnits).toLocaleString("id-ID")} {UNIT_LABEL[r.baseUnit]}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{REASON_LABEL[r.reason] ?? r.reason}</td>
                    <td className="px-4 py-3 text-right tabular-nums">Rp{r.estimatedCost.toLocaleString("id-ID")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
