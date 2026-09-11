import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { expenses } from "@/lib/db/schema";
import type { ExpenseInput } from "@/lib/validation/expense";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

export async function listExpenses(db: Database, businessId: string, limit = 200) {
  return db
    .select()
    .from(expenses)
    .where(eq(expenses.businessId, businessId))
    .orderBy(desc(expenses.expenseDate))
    .limit(limit);
}

export async function createExpense(db: Database, actor: ActorContext, input: ExpenseInput) {
  const [row] = await db
    .insert(expenses)
    .values({
      businessId: actor.businessId,
      category: input.category,
      amount: input.amount,
      expenseDate: input.expenseDate,
      payee: input.payee || null,
      referenceNumber: input.referenceNumber || null,
      notes: input.notes || null,
      recurring: input.recurring,
      createdBy: actor.userId,
    })
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "expense.created",
    entityType: "expense",
    entityId: row.id,
    after: row,
  });

  return row;
}

export async function updateExpense(db: Database, actor: ActorContext, id: string, input: ExpenseInput) {
  const [row] = await db
    .update(expenses)
    .set({
      category: input.category,
      amount: input.amount,
      expenseDate: input.expenseDate,
      payee: input.payee || null,
      referenceNumber: input.referenceNumber || null,
      notes: input.notes || null,
      recurring: input.recurring,
      updatedAt: new Date(),
    })
    .where(and(eq(expenses.id, id), eq(expenses.businessId, actor.businessId)))
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "expense.updated",
    entityType: "expense",
    entityId: id,
    after: row,
  });

  return row;
}
