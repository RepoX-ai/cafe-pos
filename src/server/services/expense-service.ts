import { and, desc, eq, getTableColumns, gte, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { averageRupiah } from "@/lib/money/money";
import { expenses, purchases, suppliers } from "@/lib/db/schema";
import type { ExpenseInput } from "@/lib/validation/expense";
import { recordAuditLog } from "./audit";
import { NotFoundError } from "./errors";
import { countUpTo, sumAsSafeInteger } from "./range-filters";
import { afterDatedCursor, cursorText, type DatedCursor } from "./keyset";
import type { ActorContext } from "./ingredient-service";
import { runIdempotent } from "./request-idempotency";

/**
 * `expenses.expense_date` is a plain Postgres `date`, not a timestamptz, so a
 * range filter compares Y-M-D calendar strings directly — no business-timezone
 * conversion is needed (or correct) here.
 */
export interface CalendarRange {
  from: string;
  to: string;
}

function rangeFilter(businessId: string, range: CalendarRange, after?: DatedCursor) {
  return and(
    eq(expenses.businessId, businessId),
    gte(expenses.expenseDate, range.from),
    lte(expenses.expenseDate, range.to),
    after ? afterDatedCursor(expenses.expenseDate, expenses.createdAt, expenses.id, after) : undefined,
  );
}

/** Newest expense date first; created_at and id keep the order stable across pages. */
export async function countExpensesInRange(db: Database, businessId: string, range: CalendarRange, cap?: number) {
  return countUpTo(db, expenses, rangeFilter(businessId, range), cap);
}

export async function listExpensesInRange(
  db: Database,
  businessId: string,
  range: CalendarRange,
  window: { limit: number; offset?: number; after?: DatedCursor },
) {
  return db
    .select({ ...getTableColumns(expenses), cursorTs: cursorText(expenses.createdAt) })
    .from(expenses)
    .where(rangeFilter(businessId, range, window.after))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt), desc(expenses.id))
    .limit(window.limit)
    .offset(window.offset ?? 0);
}

export interface ExpenseSummary {
  total: number;
  entryCount: number;
  averagePerEntry: number;
}

export async function getExpenseSummary(
  db: Database,
  businessId: string,
  range: CalendarRange,
): Promise<ExpenseSummary> {
  const [row] = await db
    .select({
      total: sumAsSafeInteger(expenses.amount),
      entryCount: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(rangeFilter(businessId, range));

  const total = row?.total ?? 0;
  const entryCount = row?.entryCount ?? 0;
  return {
    total,
    entryCount,
    averagePerEntry: averageRupiah(total, entryCount),
  };
}

export async function getExpensesByCategory(db: Database, businessId: string, range: CalendarRange) {
  return db
    .select({
      category: expenses.category,
      total: sumAsSafeInteger(expenses.amount),
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
      total: sumAsSafeInteger(expenses.amount),
      entryCount: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(rangeFilter(businessId, range))
    .groupBy(expenses.expenseDate)
    .orderBy(expenses.expenseDate);
}

export async function createExpense(db: Database, actor: ActorContext, input: ExpenseInput) {
  return db.transaction(async (tx) => {
    const { result } = await runIdempotent(
      tx,
      { businessId: actor.businessId, operation: "expense.create", key: input.idempotencyKey, payload: input },
      async (expenseId) => {
        const [row] = await tx
          .insert(expenses)
          .values({
            id: expenseId,
            businessId: actor.businessId,
            category: input.category,
            amount: input.amount,
            expenseDate: input.expenseDate,
            payee: input.payee || null,
            referenceNumber: input.referenceNumber || null,
            notes: input.notes || null,
            createdBy: actor.userId,
          })
          .returning();

        await recordAuditLog(tx, {
          businessId: actor.businessId,
          actorUserId: actor.userId,
          action: "expense.created",
          entityType: "expense",
          entityId: row.id,
          after: row,
        });

        return row;
      },
      async (id) => {
        const [row] = await tx.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.businessId, actor.businessId)));
        return row;
      },
    );
    return result;
  });
}

export async function updateExpense(db: Database, actor: ActorContext, id: string, input: ExpenseInput) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(expenses)
      .set({
        category: input.category,
        amount: input.amount,
        expenseDate: input.expenseDate,
        payee: input.payee || null,
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || null,
        updatedAt: new Date(),
      })
      .where(and(eq(expenses.id, id), eq(expenses.businessId, actor.businessId)))
      .returning();
    if (!row) throw new NotFoundError("Expense not found");

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "expense.updated",
      entityType: "expense",
      entityId: id,
      after: row,
    });

    return row;
  });
}

/**
 * One dated cash-outflow ledger. A purchase remains a purchase record; reading
 * it here avoids a duplicate editable expense and includes historical receipts.
 * Each half is tenant/date scoped before UNION ALL, then the combined rows are
 * ordered and paged together so no receipt disappears between expense pages.
 */
export type SpendingLedgerRow = {
  id: string;
  source: "expense" | "purchase";
  paidAt: string | null;
  category: string;
  amount: number;
  expenseDate: string;
  payee: string | null;
  referenceNumber: string | null;
  notes: string | null;
  recurring: boolean;
};

export async function listSpendingLedgerInRange(
  db: Database,
  businessId: string,
  range: CalendarRange,
  window: { limit: number; offset: number },
): Promise<SpendingLedgerRow[]> {
  const result = await db.execute<SpendingLedgerRow>(sql`
    select id, source, category, amount, "expenseDate", "paidAt", payee, "referenceNumber", notes, recurring
    from (
      select ${expenses.id} as id, 'expense'::text as source,
        ${expenses.category} as category, ${expenses.amount} as amount,
        to_char(${expenses.expenseDate}, 'YYYY-MM-DD') as "expenseDate", null::text as "paidAt", ${expenses.payee} as payee,
        ${expenses.referenceNumber} as "referenceNumber", ${expenses.notes} as notes,
        ${expenses.recurring} as recurring, ${expenses.createdAt} as created_at
      from ${expenses}
      where ${expenses.businessId} = ${businessId}
        and ${expenses.expenseDate} between ${range.from} and ${range.to}
      union all
      select ${purchases.id} as id, 'purchase'::text as source,
        'Ingredient purchase'::text as category, ${purchases.totalCost} as amount,
        to_char(${purchases.purchaseDate}, 'YYYY-MM-DD') as "expenseDate",
        to_char(${purchases.paidAt}, 'YYYY-MM-DD') as "paidAt", ${suppliers.name} as payee,
        ${purchases.invoiceNumber} as "referenceNumber", null::text as notes,
        false as recurring, ${purchases.createdAt} as created_at
      from ${purchases}
      left join ${suppliers} on ${purchases.supplierId} = ${suppliers.id}
        and ${suppliers.businessId} = ${businessId}
      where ${purchases.businessId} = ${businessId}
        and ${purchases.status} = 'FINALIZED'
        and ${purchases.purchaseDate} between ${range.from} and ${range.to}
    ) ledger
    order by "expenseDate" desc, created_at desc, id desc
    limit ${window.limit} offset ${window.offset}
  `);
  return result.rows;
}
