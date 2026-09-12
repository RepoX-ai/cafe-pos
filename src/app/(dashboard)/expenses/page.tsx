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
    <div className="mx-auto max-w-[1440px]">
      <ExpensesClient records={records} />
    </div>
  );
}
