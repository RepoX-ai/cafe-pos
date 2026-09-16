import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { expenses, ingredients, orderLines, orders, printJobs, wasteRecords } from "@/lib/db/schema";
import { BUSINESS_TIMEZONE, type BusinessDateRange } from "@/lib/dates/dates";
import { averageRupiah, grossMarginPercentage, toSafeInteger } from "@/lib/money/money";
import type { BaseUnit, DisplayUnit } from "@/lib/units/units";
import { abandonedPrintClaim } from "./print-service";
import { sumAsSafeInteger, withinBusinessDays, withinCalendarDates } from "./range-filters";

/**
 * Orders that count as real sales for reporting (PRD §6.12: "active order
 * revenue, excluding cancelled and refunded orders").
 */
export const ACTIVE_ORDER_STATUSES = ["SUBMITTED", "PRINT_PENDING", "PRINTED", "COMPLETED"] as const;
const REVERSED_ORDER_STATUSES = ["CANCELLED", "REFUNDED"] as const;

/** Inclusive Asia/Jakarta business dates. Order/waste/movement timestamps use half-open day bounds. */
export type DateRange = BusinessDateRange;

export interface RowWindow {
  limit: number;
  offset: number;
}

function ordersInRange(businessId: string, range: DateRange) {
  return and(eq(orders.businessId, businessId), withinBusinessDays(orders.createdAt, range));
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

/** Every summary figure in one statement; accounting definitions unchanged (PRD §6.12). */
export async function getSalesSummary(db: Database, businessId: string, range: DateRange): Promise<SalesSummary> {
  const active = inArray(orders.status, [...ACTIVE_ORDER_STATUSES]);
  const reversed = inArray(orders.status, [...REVERSED_ORDER_STATUSES]);

  const [row] = await db
    .select({
      totalSales: sumAsSafeInteger(orders.total, active),
      orderCount: sql`count(*) filter (where ${active})`.mapWith(Number),
      cogsTotal: sumAsSafeInteger(orders.cogsTotal, active),
      grossProfit: sumAsSafeInteger(orders.grossProfit, active),
      netSales: sumAsSafeInteger(sql`${orders.subtotal} - ${orders.discountTotal}`, active),
      cancelledRefundedAmount: sumAsSafeInteger(orders.total, reversed),
      wasteCost: sql`coalesce((select sum(${wasteRecords.estimatedCost}) from ${wasteRecords} where ${and(
        eq(wasteRecords.businessId, businessId),
        withinBusinessDays(wasteRecords.createdAt, range),
      )}), 0)::bigint`.mapWith(toSafeInteger),
      // expense_date is a date-only column: compared as calendar dates, no timezone shift.
      expensesTotal: sql`coalesce((select sum(${expenses.amount}) from ${expenses} where ${and(
        eq(expenses.businessId, businessId),
        withinCalendarDates(expenses.expenseDate, range),
      )}), 0)::bigint`.mapWith(toSafeInteger),
    })
    .from(orders)
    .where(ordersInRange(businessId, range));

  return {
    totalSales: row.totalSales,
    orderCount: row.orderCount,
    averageOrderValue: averageRupiah(row.totalSales, row.orderCount),
    cogsTotal: row.cogsTotal,
    grossProfit: row.grossProfit,
    grossMarginPercentage: grossMarginPercentage(row.grossProfit, row.netSales),
    cancelledRefundedAmount: row.cancelledRefundedAmount,
    wasteCost: row.wasteCost,
    expensesTotal: row.expensesTotal,
    estimatedNetProfit: row.grossProfit - row.expensesTotal,
  };
}

export async function getSalesByDay(db: Database, businessId: string, range: DateRange) {
  return db
    .select({
      day: sql<string>`to_char(${orders.createdAt} at time zone ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD')`,
      totalSales: sumAsSafeInteger(orders.total),
      orderCount: sql`count(*)`.mapWith(Number),
      cogsTotal: sumAsSafeInteger(orders.cogsTotal),
      grossProfit: sumAsSafeInteger(orders.grossProfit),
    })
    .from(orders)
    .where(and(ordersInRange(businessId, range), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

/** Grouped per menu item sold in the range, so bounded by the size of the menu. */
export async function getSalesByMenuItem(db: Database, businessId: string, range: DateRange) {
  return db
    .select({
      menuItemId: orderLines.menuItemId,
      name: orderLines.itemNameSnapshot,
      quantitySold: sumAsSafeInteger(orderLines.quantity),
      revenue: sumAsSafeInteger(orderLines.lineTotal),
      cogs: sumAsSafeInteger(orderLines.cogsSnapshot),
      grossProfit: sumAsSafeInteger(orderLines.grossProfitSnapshot),
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .where(and(ordersInRange(businessId, range), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])))
    .groupBy(orderLines.menuItemId, orderLines.itemNameSnapshot)
    .orderBy(desc(sql`4`));
}

export async function getSalesByCategory(db: Database, businessId: string, range: DateRange) {
  return db
    .select({
      categoryName: sql<string>`coalesce(${orderLines.categoryNameSnapshot}, 'Uncategorized')`,
      revenue: sumAsSafeInteger(orderLines.lineTotal),
      quantitySold: sumAsSafeInteger(orderLines.quantity),
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .where(and(ordersInRange(businessId, range), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])))
    .groupBy(orderLines.categoryNameSnapshot)
    .orderBy(desc(sql`2`));
}

export async function getSalesByPaymentMethod(db: Database, businessId: string, range: DateRange) {
  return db
    .select({
      paymentMethodLabel: sql<string>`coalesce(${orders.paymentMethodLabel}, 'unspecified')`,
      revenue: sumAsSafeInteger(orders.total),
      orderCount: sql`count(*)`.mapWith(Number),
    })
    .from(orders)
    .where(and(ordersInRange(businessId, range), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])))
    .groupBy(orders.paymentMethodLabel)
    .orderBy(desc(sql`2`));
}

/** Cancelled/refunded orders placed in the range, newest first. */
function reversedOrdersInRange(businessId: string, range: DateRange) {
  return and(ordersInRange(businessId, range), inArray(orders.status, [...REVERSED_ORDER_STATUSES]));
}

export async function countCancelledRefundedOrders(db: Database, businessId: string, range: DateRange) {
  return db.$count(orders, reversedOrdersInRange(businessId, range));
}

export async function getCancelledRefundedOrders(db: Database, businessId: string, range: DateRange, window: RowWindow) {
  return db
    .select()
    .from(orders)
    .where(reversedOrdersInRange(businessId, range))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(window.limit)
    .offset(window.offset);
}

/**
 * Jobs needing attention: failed prints, plus jobs abandoned mid-print whose
 * outcome is unknown (not yet swept to FAILED by recovery).
 */
export async function getFailedPrintJobs(db: Database, businessId: string) {
  return db
    .select({
      id: printJobs.id,
      orderId: printJobs.orderId,
      orderNumber: orders.orderNumber,
      lastError: printJobs.lastError,
      createdAt: printJobs.createdAt,
      uncertain: sql<boolean>`${printJobs.status} = 'PROCESSING'`,
    })
    .from(printJobs)
    .innerJoin(orders, eq(printJobs.orderId, orders.id))
    .where(and(eq(orders.businessId, businessId), or(eq(printJobs.status, "FAILED"), abandonedPrintClaim())))
    .orderBy(desc(printJobs.createdAt))
    .limit(20);
}

export async function getRecentOrders(db: Database, businessId: string, limit = 10) {
  return db
    .select()
    .from(orders)
    .where(eq(orders.businessId, businessId))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);
}

export type StockAlertRow = {
  id: string;
  name: string;
  currentQuantityBaseUnits: string;
  reorderLevelBaseUnits: string | null;
  baseUnit: BaseUnit;
  displayUnit: DisplayUnit | null;
};

/**
 * The first `limit` low-stock and out-of-stock active ingredients (by name),
 * filtered and limited in SQL instead of loading every ingredient.
 * "Low" includes anything at or below its reorder level, out-of-stock ones too.
 */
export async function getStockAlerts(db: Database, businessId: string, limit = 6) {
  const result = await db.execute<StockAlertRow & { kind: "low" | "out" }>(sql`
    select kind, id, name, "currentQuantityBaseUnits", "reorderLevelBaseUnits", "baseUnit", "displayUnit"
    from (
      select k.kind,
             ${ingredients.id} as id,
             ${ingredients.name} as name,
             ${ingredients.currentQuantityBaseUnits} as "currentQuantityBaseUnits",
             ${ingredients.reorderLevelBaseUnits} as "reorderLevelBaseUnits",
             ${ingredients.baseUnit} as "baseUnit",
             ${ingredients.displayUnit} as "displayUnit",
             row_number() over (partition by k.kind order by ${ingredients.name}, ${ingredients.id}) as position
      from ${ingredients}
      cross join (values ('low'), ('out')) as k(kind)
      where ${ingredients.businessId} = ${businessId}
        and ${ingredients.active}
        and (
          (k.kind = 'low' and ${ingredients.reorderLevelBaseUnits} is not null
            and ${ingredients.currentQuantityBaseUnits} <= ${ingredients.reorderLevelBaseUnits})
          or (k.kind = 'out' and ${ingredients.currentQuantityBaseUnits} <= 0)
        )
    ) ranked
    where position <= ${limit}
    order by kind, position
  `);
  const toRow = ({ id, name, currentQuantityBaseUnits, reorderLevelBaseUnits, baseUnit, displayUnit }: StockAlertRow): StockAlertRow => ({
    id,
    name,
    currentQuantityBaseUnits,
    reorderLevelBaseUnits,
    baseUnit,
    displayUnit,
  });
  return {
    lowStock: result.rows.filter((row) => row.kind === "low").map(toRow),
    outOfStock: result.rows.filter((row) => row.kind === "out").map(toRow),
  };
}
