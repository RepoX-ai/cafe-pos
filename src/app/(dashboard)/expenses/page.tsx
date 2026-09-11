import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listExpenses } from "@/server/services/expense-service";
import { ExpensesClient } from "./expenses-client";

export const metadata: Metadata = {
  title: "Expenses — CaféOps",
};

export default async function ExpensesPage() {
  const user = await requirePageAccess("expenses:write");
  const records = await listExpenses(db, user.businessId);

  return (
    <div className="mx-auto max-w-[1000px] px-8 py-10">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Expenses</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Manual operating expenses. These affect estimated net profit but never order COGS.
      </p>

      <div className="mt-8">
        <ExpensesClient records={records} />
      </div>
    </div>
  );
}
