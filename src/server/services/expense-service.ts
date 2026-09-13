import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { expenses } from "@/lib/db/schema";
import type { ExpenseInput } from "@/lib/validation/expense";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

/**
 * `expenses.expense_date` is a plain Postgres `date`, not a timestamptz, so a
 * range filter compares Y-M-D calendar strings directly — no business-timezone
 * conversion is needed (or correct) here.
 */
export interface CalendarRange {
  from: string;
  to: string;
}

function rangeFilter(businessId: string, range: CalendarRange) {
  return and(
    eq(expenses.businessId, businessId),
    gte(expenses.expenseDate, range.from),
    lte(expenses.expenseDate, range.to),
  );
}

export async function listExpensesInRange(db: Database, businessId: string, range: CalendarRange, limit = 500) {
  return db
    .select()
    .from(expenses)
    .where(rangeFilter(businessId, range))
    .orderBy(desc(expenses.expenseDate))
    .limit(limit);
}

export interface ExpenseSummary {
  total: number;
  entryCount: number;
  averagePerEntry: number;
  recurringTotal: number;
}

export async function getExpenseSummary(
  db: Database,
  businessId: string,
  range: CalendarRange,
): Promise<ExpenseSummary> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${expenses.amount}), 0)::int`,
      entryCount: sql<number>`count(*)::int`,
      recurringTotal: sql<number>`coalesce(sum(${expenses.amount}) filter (where ${expenses.recurring}), 0)::int`,
    })
    .from(expenses)
    .where(rangeFilter(businessId, range));

  const total = row?.total ?? 0;
  const entryCount = row?.entryCount ?? 0;
  return {
    total,
    entryCount,
    averagePerEntry: entryCount > 0 ? Math.round(total / entryCount) : 0,
    recurringTotal: row?.recurringTotal ?? 0,
  };
}

export async function getExpensesByCategory(db: Database, businessId: string, range: CalendarRange) {
  return db
    .select({
      category: expenses.category,
      total: sql<number>`coalesce(sum(${expenses.amount}), 0)::int`,
      entryCount: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(rangeFilter(businessId, range))
    .groupBy(expenses.category)
    .orderBy(desc(sql`2`));
}

export async function getExpensesByDay(db: Database, businessId: string, range: CalendarRange) {
  return db
    .select({
      day: sql<string>`to_char(${expenses.expenseDate}, 'YYYY-MM-DD')`,
      total: sql<number>`coalesce(sum(${expenses.amount}), 0)::int`,
      entryCount: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(rangeFilter(businessId, range))
    .groupBy(expenses.expenseDate)
    .orderBy(expenses.expenseDate);
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
