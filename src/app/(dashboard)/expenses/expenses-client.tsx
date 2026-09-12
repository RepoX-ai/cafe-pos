"use client";

import { formatIDR } from "@/lib/money/money";
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName, textareaClassName } from "@/components/ui/form-styles";
import { DatePicker } from "@/components/ui/date-picker";
import { Pagination } from "@/components/ui/pagination";
import { usePagination } from "@/components/ui/use-pagination";
import { EXPENSE_CATEGORIES } from "@/lib/validation/expense";
import { createExpenseAction, updateExpenseAction, type ExpenseActionState } from "./actions";
import { useActionResultToast } from "@/components/ui/use-action-toast";

interface ExpenseRow {
  id: string;
  category: string;
  amount: number;
  expenseDate: string;
  payee: string | null;
  referenceNumber: string | null;
  notes: string | null;
  recurring: boolean;
}

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c, c.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())]),
);

export function ExpensesClient({ records }: { records: ExpenseRow[] }) {
  const [drawerState, setDrawerState] = useState<{ mode: "create" } | { mode: "edit"; row: ExpenseRow } | null>(
    null,
  );

  const total = records.reduce((sum, r) => sum + r.amount, 0);
  const { page, setPage, totalPages, pageItems, pageSize, totalItems } = usePagination(records, 20);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Expenses</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Manual operating expenses. These affect estimated net profit but never order COGS.
          </p>
        </div>
        <Button onClick={() => setDrawerState({ mode: "create" })}>
          <Plus size={16} />
          Record expense
        </Button>
      </div>

      <Modal
        open={drawerState !== null}
        onClose={() => setDrawerState(null)}
        title={drawerState?.mode === "edit" ? "Edit expense" : "Record expense"}
      >
        {drawerState ? (
          <ExpenseForm
            key={drawerState.mode === "edit" ? drawerState.row.id : "create"}
            existing={drawerState.mode === "edit" ? drawerState.row : null}
            onDone={() => setDrawerState(null)}
          />
        ) : null}
      </Modal>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">History</h2>
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">Total: {formatIDR(total)}</span>
        </div>
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Payee</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                    No expenses recorded yet.
                  </td>
                </tr>
              ) : (
                pageItems.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.expenseDate}</td>
                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.payee ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatIDR(r.amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDrawerState({ mode: "edit", row: r })}
                        className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
                        aria-label={`Edit expense on ${r.expenseDate}`}
                      >
                        <Pencil size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          <Pagination page={page} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}

function ExpenseForm({ existing, onDone }: { existing: ExpenseRow | null; onDone: () => void }) {
  const action = existing ? updateExpenseAction : createExpenseAction;
  const [state, formAction, isPending] = useActionState<ExpenseActionState, FormData>(action, undefined);
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, existing ? "Expense saved." : "Expense recorded.");

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-4">
      {existing ? <input type="hidden" name="id" value={existing.id} /> : null}

      <Field label="Category" htmlFor="category" error={errorState?.fieldErrors?.category}>
        <Select id="category" name="category" defaultValue={existing?.category} required>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount (Rp)" htmlFor="amount" error={errorState?.fieldErrors?.amount}>
        <input
          id="amount"
          name="amount"
          type="number"
          min={0}
          required
          defaultValue={existing?.amount}
          className={inputClassName}
        />
      </Field>
      <Field label="Date" htmlFor="expenseDate" error={errorState?.fieldErrors?.expenseDate}>
        <DatePicker id="expenseDate" name="expenseDate" defaultValue={existing?.expenseDate ?? new Date().toISOString().slice(0, 10)} />
      </Field>
      <Field label="Payee / supplier" htmlFor="payee">
        <input id="payee" name="payee" defaultValue={existing?.payee ?? ""} className={inputClassName} />
      </Field>
      <Field label="Reference #" htmlFor="referenceNumber">
        <input id="referenceNumber" name="referenceNumber" defaultValue={existing?.referenceNumber ?? ""} className={inputClassName} />
      </Field>
      <div className="flex items-end pb-2.5">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <Checkbox name="recurring" defaultChecked={existing?.recurring ?? false} />
          Recurring
        </label>
      </div>
      <div className="col-span-2">
        <Field label="Notes" htmlFor="notes">
          <textarea id="notes" name="notes" defaultValue={existing?.notes ?? ""} className={textareaClassName} />
        </Field>
      </div>

      {errorState?.error ? (
        <p role="alert" className="col-span-2 rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState.error}
        </p>
      ) : null}

      <div className="col-span-2 mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : existing ? "Save changes" : "Record expense"}
        </Button>
      </div>
    </form>
  );
}
