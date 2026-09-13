import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  expenses,
  inventoryMovements,
  orderLines,
  orders,
  printJobs,
  wasteRecords,
} from "@/lib/db/schema";
import { grossMarginPercentage } from "@/lib/money/money";

/**
 * Orders that count as real sales for reporting (PRD §6.12: "active order
 * revenue, excluding cancelled and refunded orders").
 */
export const ACTIVE_ORDER_STATUSES = ["SUBMITTED", "PRINT_PENDING", "PRINTED", "COMPLETED"] as const;

export interface DateRange {
  from: Date;
  to: Date;
}

function orderDateFilter(businessId: string, range: DateRange) {
  return and(
    eq(orders.businessId, businessId),
    gte(orders.createdAt, range.from),
    lte(orders.createdAt, range.to),
  );
}

export interface SalesSummary {
  totalSales: number;
  orderCount: number;
  averageOrderValue: number;
  cogsTotal: number;
  grossProfit: number;
  grossMarginPercentage: number | null;
  cancelledRefundedAmount: number;
  wasteCost: number;
  expensesTotal: number;
  estimatedNetProfit: number;
}

export async function getSalesSummary(db: Database, businessId: string, range: DateRange): Promise<SalesSummary> {
  const [active] = await db
    .select({
      totalSales: sql<number>`coalesce(sum(${orders.total}), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
      cogsTotal: sql<number>`coalesce(sum(${orders.cogsTotal}), 0)::int`,
      grossProfit: sql<number>`coalesce(sum(${orders.grossProfit}), 0)::int`,
      netSales: sql<number>`coalesce(sum(${orders.subtotal} - ${orders.discountTotal}), 0)::int`,
    })
    .from(orders)
    .where(and(orderDateFilter(businessId, range), inArray(orders.status, ACTIVE_ORDER_STATUSES)));

  const [cancelled] = await db
    .select({ amount: sql<number>`coalesce(sum(${orders.total}), 0)::int` })
    .from(orders)
    .where(and(orderDateFilter(businessId, range), inArray(orders.status, ["CANCELLED", "REFUNDED"])));

  const [waste] = await db
    .select({ cost: sql<number>`coalesce(sum(${wasteRecords.estimatedCost}), 0)::int` })
    .from(wasteRecords)
    .where(and(eq(wasteRecords.businessId, businessId), gte(wasteRecords.createdAt, range.from), lte(wasteRecords.createdAt, range.to)));

  const [expenseTotals] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)::int` })
    .from(expenses)
    .where(and(eq(expenses.businessId, businessId), gte(expenses.expenseDate, toDateOnly(range.from)), lte(expenses.expenseDate, toDateOnly(range.to))));

  const grossProfit = active?.grossProfit ?? 0;
  const expensesTotal = expenseTotals?.total ?? 0;

  return {
    totalSales: active?.totalSales ?? 0,
    orderCount: active?.orderCount ?? 0,
    averageOrderValue: active?.orderCount ? Math.round((active.totalSales ?? 0) / active.orderCount) : 0,
    cogsTotal: active?.cogsTotal ?? 0,
    grossProfit,
    grossMarginPercentage: grossMarginPercentage(grossProfit, active?.netSales ?? 0),
    cancelledRefundedAmount: cancelled?.amount ?? 0,
    wasteCost: waste?.cost ?? 0,
    expensesTotal,
    estimatedNetProfit: grossProfit - expensesTotal,
  };
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getSalesByDay(db: Database, businessId: string, range: DateRange) {
  return db
    .select({
      day: sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`,
      totalSales: sql<number>`coalesce(sum(${orders.total}), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
      cogsTotal: sql<number>`coalesce(sum(${orders.cogsTotal}), 0)::int`,
      grossProfit: sql<number>`coalesce(sum(${orders.grossProfit}), 0)::int`,
    })
    .from(orders)
    .where(and(orderDateFilter(businessId, range), inArray(orders.status, ACTIVE_ORDER_STATUSES)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

export async function getSalesByMenuItem(db: Database, businessId: string, range: DateRange) {
  return db
    .select({
      menuItemId: orderLines.menuItemId,
      name: orderLines.itemNameSnapshot,
      quantitySold: sql<number>`coalesce(sum(${orderLines.quantity}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${orderLines.lineTotal}), 0)::int`,
      cogs: sql<number>`coalesce(sum(${orderLines.cogsSnapshot}), 0)::int`,
      grossProfit: sql<number>`coalesce(sum(${orderLines.grossProfitSnapshot}), 0)::int`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .where(and(orderDateFilter(businessId, range), inArray(orders.status, ACTIVE_ORDER_STATUSES)))
    .groupBy(orderLines.menuItemId, orderLines.itemNameSnapshot)
    .orderBy(desc(sql`4`));
}

export async function getSalesByCategory(db: Database, businessId: string, range: DateRange) {
  return db
    .select({
      categoryName: sql<string>`coalesce(${orderLines.categoryNameSnapshot}, 'Uncategorized')`,
      revenue: sql<number>`coalesce(sum(${orderLines.lineTotal}), 0)::int`,
      quantitySold: sql<number>`coalesce(sum(${orderLines.quantity}), 0)::int`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .where(and(orderDateFilter(businessId, range), inArray(orders.status, ACTIVE_ORDER_STATUSES)))
    .groupBy(orderLines.categoryNameSnapshot)
    .orderBy(desc(sql`2`));
}

export async function getSalesByPaymentMethod(db: Database, businessId: string, range: DateRange) {
  return db
    .select({
      paymentMethodLabel: sql<string>`coalesce(${orders.paymentMethodLabel}, 'unspecified')`,
      revenue: sql<number>`coalesce(sum(${orders.total}), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(and(orderDateFilter(businessId, range), inArray(orders.status, ACTIVE_ORDER_STATUSES)))
    .groupBy(orders.paymentMethodLabel)
    .orderBy(desc(sql`2`));
}

export async function getCancelledRefundedOrders(db: Database, businessId: string, range: DateRange) {
  return db
    .select()
    .from(orders)
    .where(and(orderDateFilter(businessId, range), inArray(orders.status, ["CANCELLED", "REFUNDED"])))
    .orderBy(desc(orders.createdAt));
}

export async function getExpensesInRange(db: Database, businessId: string, range: DateRange) {
  return db
    .select()
    .from(expenses)
    .where(and(eq(expenses.businessId, businessId), gte(expenses.expenseDate, toDateOnly(range.from)), lte(expenses.expenseDate, toDateOnly(range.to))))
    .orderBy(desc(expenses.expenseDate));
}

export async function getInventoryMovementsInRange(db: Database, businessId: string, range: DateRange) {
  return db
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.businessId, businessId), gte(inventoryMovements.createdAt, range.from), lte(inventoryMovements.createdAt, range.to)))
    .orderBy(desc(inventoryMovements.createdAt));
}

export async function getFailedPrintJobs(db: Database, businessId: string) {
  return db
    .select({ id: printJobs.id, orderId: printJobs.orderId, orderNumber: orders.orderNumber, lastError: printJobs.lastError, createdAt: printJobs.createdAt })
    .from(printJobs)
    .innerJoin(orders, eq(printJobs.orderId, orders.id))
    .where(and(eq(orders.businessId, businessId), eq(printJobs.status, "FAILED")))
    .orderBy(desc(printJobs.createdAt))
    .limit(20);
}

export async function getRecentOrders(db: Database, businessId: string, limit = 10) {
  return db.select().from(orders).where(eq(orders.businessId, businessId)).orderBy(desc(orders.createdAt)).limit(limit);
}
