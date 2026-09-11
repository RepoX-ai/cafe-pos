"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { expenseInputSchema } from "@/lib/validation/expense";
import { createExpense } from "@/server/services/expense-service";

export type ExpenseActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

export async function createExpenseAction(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "expenses:write");

  const parsed = expenseInputSchema.safeParse({
    category: formData.get("category"),
    amount: formData.get("amount"),
    expenseDate: formData.get("expenseDate"),
    payee: formData.get("payee"),
    referenceNumber: formData.get("referenceNumber"),
    notes: formData.get("notes"),
    recurring: formData.get("recurring") === "on",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }

  await createExpense(db, { businessId: user.businessId, userId: user.id }, parsed.data);
  revalidatePath("/expenses");
  return { ok: true };
}
