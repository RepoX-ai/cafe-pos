import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { expenses, ingredients, orderLineModifiers, orderLines, orders, printJobs, wasteRecords } from "@/lib/db/schema";
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

/** One menu item's aggregate row in a dashboard ranking. */
export interface MenuRankingRow {
  menuItemId: string | null;
  name: string;
  quantitySold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
}

/** Guards against an unbounded or nonsensical limit reaching SQL. */
export const MENU_RANKING_MAX_LIMIT = 50;

export function clampRankingLimit(limit: number) {
  if (!Number.isFinite(limit)) return 1;
  return Math.min(MENU_RANKING_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

type RankedRow = {
  menuItemId: string | null;
  name: string;
  quantitySold: string;
  revenue: string;
  cogs: string;
  grossProfit: string;
  quantityRank: string;
  cogsRank: string;
};

/**
 * The dashboard's two menu rankings — most units sold, and highest total
 * COGS — in one statement that returns at most `2 * limit` rows.
 *
 * Same grouping, tenant filter, business-day bounds, active-order statuses
 * and snapshot columns as `getSalesByMenuItem`; the only difference is that
 * PostgreSQL does the ranking and the cut. "Top selling" stays units sold
 * (not revenue) and "highest COGS" stays total COGS in Rupiah (not a COGS
 * percentage). A deleted menu item keeps its own row: `menu_item_id` goes
 * NULL on delete, so the name snapshot is what distinguishes it, exactly as
 * in the full report.
 *
 * Ties break on name then id, so a tie renders the same way on every load —
 * the JavaScript sort this replaced left ties in whatever order the group-by
 * happened to emit.
 *
 * What this does and doesn't buy: LIMIT cuts the rows PostgreSQL returns and
 * the rows the page sorts, from "every distinct menu item sold in the range"
 * to ten. It does not cut the rows the database must scan and aggregate —
 * that is still every order line in the range, once, shared by both
 * rankings via the CTE. `getSalesByMenuItem` stays untouched for the reports
 * page and the CSV exports, which genuinely need every group.
 */
export async function getTopMenuItemRankings(
  db: Database,
  businessId: string,
  range: DateRange,
  limit = 5,
): Promise<{ topSelling: MenuRankingRow[]; highestCogs: MenuRankingRow[] }> {
  const rowLimit = clampRankingLimit(limit);
  const scope = and(ordersInRange(businessId, range), inArray(orders.status, [...ACTIVE_ORDER_STATUSES]));

  const result = await db.execute<RankedRow>(sql`
    with grouped as (
      select ${orderLines.menuItemId} as "menuItemId",
             ${orderLines.itemNameSnapshot} as name,
             coalesce(sum(${orderLines.quantity}), 0)::bigint as "quantitySold",
             coalesce(sum(${orderLines.lineTotal}), 0)::bigint as revenue,
             coalesce(sum(${orderLines.cogsSnapshot}), 0)::bigint as cogs,
             coalesce(sum(${orderLines.grossProfitSnapshot}), 0)::bigint as "grossProfit"
      from ${orderLines}
      inner join ${orders} on ${orderLines.orderId} = ${orders.id}
      where ${scope}
      group by ${orderLines.menuItemId}, ${orderLines.itemNameSnapshot}
    ),
    ranked as (
      select grouped.*,
             row_number() over (order by "quantitySold" desc, name asc, "menuItemId" asc nulls last) as "quantityRank",
             row_number() over (order by cogs desc, name asc, "menuItemId" asc nulls last) as "cogsRank"
      from grouped
    )
    select * from ranked
    where "quantityRank" <= ${rowLimit} or "cogsRank" <= ${rowLimit}
  `);

  const toRow = (row: RankedRow): MenuRankingRow => ({
    menuItemId: row.menuItemId,
    name: row.name,
    quantitySold: toSafeInteger(row.quantitySold),
    revenue: toSafeInteger(row.revenue),
    cogs: toSafeInteger(row.cogs),
    grossProfit: toSafeInteger(row.grossProfit),
  });

  const byRank = (key: "quantityRank" | "cogsRank") =>
    result.rows
      .filter((row) => Number(row[key]) <= rowLimit)
      .sort((a, b) => Number(a[key]) - Number(b[key]))
      .map(toRow);

  return { topSelling: byRank("quantityRank"), highestCogs: byRank("cogsRank") };
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

/**
 * Sales by category with modifier revenue pulled out into its own total, for
 * the dashboard chart. Each category keeps only its lines' base + variant
 * price; every modifier's price adjustment (per unit, snapshotted at order
 * time) × line quantity is summed into `modifiers` instead. The two parts
 * add up to the same revenue `getSalesByCategory` reports.
 */
export async function getSalesByCategoryWithModifiers(db: Database, businessId: string, range: DateRange) {
  const lineModifiers = db
    .select({
      orderLineId: orderLineModifiers.orderLineId,
      unitPrice: sql<number>`sum(${orderLineModifiers.priceAdjustmentSnapshot})`.as("unit_price"),
      optionCount: sql<number>`count(*)`.as("option_count"),
    })
    .from(orderLineModifiers)
    .groupBy(orderLineModifiers.orderLineId)
    .as("line_modifiers");
  const modifierRevenue = sql`coalesce(${lineModifiers.unitPrice}, 0) * ${orderLines.quantity}`;

  const rows = await db
    .select({
      categoryName: sql<string>`coalesce(${orderLines.categoryNameSnapshot}, 'Uncategorized')`,
      revenue: sumAsSafeInteger(sql`${orderLines.lineTotal} - ${modifierRevenue}`),
      quantitySold: sumAsSafeInteger(orderLines.quantity),
      modifierRevenue: sumAsSafeInteger(modifierRevenue),
      modifierQuantity: sumAsSafeInteger(sql`coalesce(${lineModifiers.optionCount}, 0) * ${orderLines.quantity}`),
    })
    .from(orderLines)
    .innerJoin(orders, eq(orderLines.orderId, orders.id))
    .leftJoin(lineModifiers, eq(lineModifiers.orderLineId, orderLines.id))
    .where(and(ordersInRange(businessId, range), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])))
    .groupBy(orderLines.categoryNameSnapshot)
    .orderBy(desc(sql`2`));

  return {
    categories: rows.map(({ categoryName, revenue, quantitySold }) => ({ categoryName, revenue, quantitySold })),
    modifiers: {
      revenue: rows.reduce((sum, r) => sum + r.modifierRevenue, 0),
      quantitySold: rows.reduce((sum, r) => sum + r.modifierQuantity, 0),
    },
  };
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
