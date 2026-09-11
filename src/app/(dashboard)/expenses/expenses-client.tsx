"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClassName, selectClassName, textareaClassName } from "@/components/ui/form-field";
import { EXPENSE_CATEGORIES } from "@/lib/validation/expense";
import { createExpenseAction, type ExpenseActionState } from "./actions";

interface ExpenseRow {
  id: string;
  category: string;
  amount: number;
  expenseDate: string;
  payee: string | null;
  referenceNumber: string | null;
  recurring: boolean;
}

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c, c.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())]),
);

function formatIDR(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

export function ExpensesClient({ records }: { records: ExpenseRow[] }) {
  const [state, formAction, isPending] = useActionState<ExpenseActionState, FormData>(createExpenseAction, undefined);
  const errorState = state && !state.ok ? state : undefined;

  const total = records.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="grid grid-cols-2 gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <Field label="Category" htmlFor="category" error={errorState?.fieldErrors?.category}>
          <select id="category" name="category" required className={selectClassName}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (Rp)" htmlFor="amount" error={errorState?.fieldErrors?.amount}>
          <input id="amount" name="amount" type="number" min={0} required className={inputClassName} />
        </Field>
        <Field label="Date" htmlFor="expenseDate" error={errorState?.fieldErrors?.expenseDate}>
          <input id="expenseDate" name="expenseDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required className={inputClassName} />
        </Field>
        <Field label="Payee / supplier" htmlFor="payee">
          <input id="payee" name="payee" className={inputClassName} />
        </Field>
        <Field label="Reference #" htmlFor="referenceNumber">
          <input id="referenceNumber" name="referenceNumber" className={inputClassName} />
        </Field>
        <div className="flex items-end pb-2.5">
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
            <input type="checkbox" name="recurring" />
            Recurring
          </label>
        </div>
        <div className="col-span-2">
          <Field label="Notes" htmlFor="notes">
            <textarea id="notes" name="notes" className={textareaClassName} />
          </Field>
        </div>

        <div className="col-span-2 flex flex-col gap-3">
          {errorState?.error ? (
            <p role="alert" className="rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
              {errorState.error}
            </p>
          ) : null}
          {state?.ok ? (
            <p role="status" className="rounded-[var(--radius-sm)] bg-[#E7F8EF] px-3 py-2 text-sm text-[var(--color-success)]">
              Expense recorded.
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Record expense"}
            </Button>
          </div>
        </div>
      </form>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">History</h2>
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">Total: {formatIDR(total)}</span>
        </div>
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Payee</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                    No expenses recorded yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.expenseDate}</td>
                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.payee ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatIDR(r.amount)}</td>
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
