"use client";

import Link from "next/link";
import { formatIDR } from "@/lib/money/money";
import { useEffect, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { CalendarDays, Layers, Plus, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangeForm } from "@/components/ui/date-range-form";
import { StatCard, computeTrend } from "@/components/ui/stat-card";
import { TrendChart, type TrendPoint } from "@/components/ui/trend-chart";
import type { ExpenseSummary, SpendingLedgerRow } from "@/server/services/expense-service";
import { Modal } from "@/components/ui/modal";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName, textareaClassName } from "@/components/ui/form-styles";
import { DatePicker } from "@/components/ui/date-picker";
import { ActionMenu } from "@/components/ui/action-menu";
import { EXPENSE_CATEGORIES } from "@/lib/validation/expense";
import { createExpenseAction, updateExpenseAction, type ExpenseActionState } from "./actions";
import { useSubmissionKey } from "@/components/ui/use-submission-key";
import { useActionResultToast } from "@/components/ui/use-action-toast";

interface CategoryTotal {
  category: string;
  total: number;
  entryCount: number;
}

type ExpenseRow = SpendingLedgerRow;

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c, c.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())]),
);

export function ExpensesClient({
  records,
  pagination,
  summary,
  purchaseSpend,
  paidPurchaseSpend,
  previousPurchaseSpend,
  previousSummary,
  byCategory,
  trendData,
  rangeLengthDays,
  from,
  to,
  today,
}: {
  /** One server-fetched page of the range's expenses. */
  records: ExpenseRow[];
  pagination?: ReactNode;
  summary: ExpenseSummary;
  purchaseSpend: { total: number; count: number };
  paidPurchaseSpend: { total: number; count: number };
  previousPurchaseSpend: { total: number; count: number };
  previousSummary: ExpenseSummary;
  byCategory: CategoryTotal[];
  trendData: TrendPoint[];
  rangeLengthDays: number;
  from: string;
  to: string;
  today: string;
}) {
  const [drawerState, setDrawerState] = useState<{ mode: "create" } | { mode: "edit"; row: ExpenseRow } | null>(
    null,
  );

  const totalSpent = summary.total + purchaseSpend.total;
  const totalEntries = summary.entryCount + purchaseSpend.count;
  const averagePerDay = rangeLengthDays > 0 ? Math.round(totalSpent / rangeLengthDays) : 0;
  const previousAveragePerDay = rangeLengthDays > 0 ? Math.round((previousSummary.total + previousPurchaseSpend.total) / rangeLengthDays) : 0;
  const largestCategoryTotal = byCategory[0]?.total ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Expenses</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Operating expenses and ingredient purchases. Record ingredient purchases through Purchases, not the manual expense form. Their costs enter profit through sold-item COGS.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeForm from={from} to={to} today={today} basePath="/expenses" />
          <Button onClick={() => setDrawerState({ mode: "create" })}>
            <Plus size={16} />
            Record expense
          </Button>
        </div>
      </div>

      <div>
        {/* A rise in spend is bad news, so every trend arrow here reads inverted
            against the dashboard's revenue cards. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={Wallet}
            label="Recorded spending"
            value={formatIDR(summary.total + purchaseSpend.total)}
            trend={computeTrend(summary.total + purchaseSpend.total, previousSummary.total + previousPurchaseSpend.total)}
            previousLabel={`vs. ${formatIDR(previousSummary.total + previousPurchaseSpend.total)} last period`}
            trendMeansGood={false}
            emphasize
          />
          <StatCard
            icon={Receipt}
            label="Entries"
            value={(summary.entryCount + purchaseSpend.count).toLocaleString("id-ID")}
            trend={computeTrend(summary.entryCount + purchaseSpend.count, previousSummary.entryCount + previousPurchaseSpend.count)}
            previousLabel={`vs. ${(previousSummary.entryCount + previousPurchaseSpend.count).toLocaleString("id-ID")} last period`}
            trendMeansGood={false}
          />
          <StatCard
            icon={CalendarDays}
            label="Avg per day"
            value={formatIDR(averagePerDay)}
            trend={computeTrend(averagePerDay, previousAveragePerDay)}
            previousLabel={`over ${rangeLengthDays} ${rangeLengthDays === 1 ? "day" : "days"}`}
            trendMeansGood={false}
          />
          <StatCard icon={Layers} label="Supplier payments" value={formatIDR(paidPurchaseSpend.total)} />
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Recorded spending includes {formatIDR(purchaseSpend.total)} of received ingredients, paid or unpaid, dated by receipt. Supplier payments use confirmed payment dates. Profit counts ingredients when sold through COGS. Figures cover {from} → {to}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:col-span-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Spending trend — last 14 days</h2>
          <div className="mt-3">
            <TrendChart
              data={trendData}
              ariaLabel="Daily spending total for the last 14 days"
              emptyText="No spending in the last 14 days."
            />
          </div>
        </div>

        <div className="flex flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:col-span-1">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">By category</h2>
          {byCategory.length === 0 ? (
            <p className="py-2 text-sm text-[var(--color-text-secondary)]">No expenses in this range.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {byCategory.map((c) => (
                <li key={c.category}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-[var(--color-text-primary)]">
                      {CATEGORY_LABEL[c.category] ?? c.category}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--color-text-primary)]">
                      {formatIDR(c.total)}
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                        {shareOfTotal(c.total, totalSpent)}
                      </span>
                    </span>
                  </div>
                  {/* Bars are scaled against the largest category, not the total, so
                      small categories stay visible instead of collapsing to a sliver. */}
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-page-bg)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent-primary)]"
                      style={{ width: `${largestCategoryTotal > 0 ? (c.total / largestCategoryTotal) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Spending history</h2>
          <span className="text-sm font-medium text-[var(--color-text-secondary)]">Total: {formatIDR(summary.total + purchaseSpend.total)}</span>
        </div>
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Payee</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                    No spending recorded between {from} and {to}.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.expenseDate}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.source === "purchase" ? (
                      <span>Purchase<span className="block text-xs">{r.paidAt ? `Paid ${r.paidAt}` : "Payment unconfirmed"}</span></span>
                    ) : "Manual expense"}</td>
                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{r.payee ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{formatIDR(r.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        {r.source === "purchase" ? (
                          <Link href={`/purchases/${r.id}`} className="text-sm text-[var(--color-accent-primary)] underline">View receipt</Link>
                        ) : (
                          <ActionMenu
                            label={`Actions for the expense on ${r.expenseDate}`}
                            items={[{ label: "Edit details", onSelect: () => setDrawerState({ mode: "edit", row: r }) }]}
                          />
                        )}
                      </div>
                    </td>
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

/** Share of a total as a whole percent, or an em dash when there's no total to divide by. */
function shareOfTotal(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

function ExpenseForm({ existing, onDone }: { existing: ExpenseRow | null; onDone: () => void }) {
  const action = existing ? updateExpenseAction : createExpenseAction;
  const [state, formAction, isPending] = useActionState<ExpenseActionState, FormData>(action, undefined);
  // New expenses only (edits are naturally idempotent). A new key once a
  // response arrives; kept across a retry that got none.
  const [submissionKey, rotateSubmissionKey] = useSubmissionKey();
  useEffect(() => {
    if (state) rotateSubmissionKey();
  }, [state, rotateSubmissionKey]);
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, existing ? "Expense saved." : "Expense recorded.");

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-4">
      {existing ? null : <input type="hidden" name="idempotencyKey" value={submissionKey} />}
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
