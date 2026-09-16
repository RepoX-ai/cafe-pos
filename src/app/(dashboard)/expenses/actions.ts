"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/permissions/permissions";
import { expenseInputSchema } from "@/lib/validation/expense";
import { flattenZodErrors } from "@/lib/validation/form-errors";
import { createExpense, updateExpense } from "@/server/services/expense-service";

export type ExpenseActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

function parseExpenseForm(formData: FormData) {
  return expenseInputSchema.safeParse({
    category: formData.get("category"),
    amount: formData.get("amount"),
    expenseDate: formData.get("expenseDate"),
    payee: formData.get("payee"),
    referenceNumber: formData.get("referenceNumber"),
    notes: formData.get("notes"),
  });
}

export async function createExpenseAction(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "expenses:write");

  const parsed = parseExpenseForm(formData);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  await createExpense(db, { businessId: user.businessId, userId: user.id }, parsed.data);
  revalidatePath("/expenses");
  return { ok: true };
}

export async function updateExpenseAction(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const user = await requireCurrentUser();
  requirePermission(user.roles, "expenses:write");

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing expense id." };

  const parsed = parseExpenseForm(formData);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  await updateExpense(db, { businessId: user.businessId, userId: user.id }, id, parsed.data);
  revalidatePath("/expenses");
  return { ok: true };
}
