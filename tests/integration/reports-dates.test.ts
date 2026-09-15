import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { pageWindow, toPage } from "@/lib/pagination";
import { getTestDb, seedTestFixture } from "./helpers";
import { getSalesByDay, getSalesSummary, getCancelledRefundedOrders } from "@/server/services/reports-service";
import { getExpenseSummary, listExpensesInRange } from "@/server/services/expense-service";
import { listMovements } from "@/server/services/inventory-service";
import { listPurchases } from "@/server/services/purchase-service";
import { listWasteRecords } from "@/server/services/waste-service";
import { writeReportCsv, type ReportType } from "@/server/services/report-exports";

const db = getTestDb();
afterAll(async () => db?.$client.end());

type OrderStatus = (typeof schema.orders.$inferInsert)["status"];

async function insertOrder(businessId: string, createdAt: string, total: number, status: OrderStatus = "SUBMITTED") {
  const [order] = await db!
    .insert(schema.orders)
    .values({
      businessId,
      orderNumber: `R-${randomUUID()}`,
      idempotencyKey: randomUUID(),
      status,
      subtotal: total,
      total,
      grossProfit: total,
      createdAt: new Date(createdAt),
    })
    .returning();
  return order;
}

async function exportCsv(businessId: string, type: ReportType, range: { from: string; to: string }) {
  const chunks: string[] = [];
  await writeReportCsv(db!, businessId, type, range, (chunk) => chunks.push(chunk), { batchSize: 50 });
  const [header, ...rows] = chunks.join("").split("\r\n");
  return { header, rows: rows.map((row) => row.split(",")) };
}

/** Walks a paginated screen query to the end, the way a user clicking "next" would. */
async function allPages<T extends { id: string }>(fetch: (window: { limit: number; offset: number }) => Promise<T[]>) {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const window = pageWindow(page);
    const result = toPage(await fetch(window), window.page, window.pageSize);
    rows.push(...result.rows);
    if (!result.hasNextPage) return rows;
  }
}

describe.skipIf(!db)("report dates and exports (PostgreSQL)", () => {
  it("assigns orders to Jakarta business days, including the last and first millisecond of a day", async () => {
    const { business } = await seedTestFixture(db!);
    await insertOrder(business.id, "2026-01-31T16:59:59.999Z", 100); // Jan 31, 23:59:59.999 WIB
    await insertOrder(business.id, "2026-01-31T17:00:00.000Z", 200); // Feb 1, 00:00 WIB
    await insertOrder(business.id, "2026-02-01T16:59:59.999Z", 400); // Feb 1, 23:59:59.999 WIB
    await insertOrder(business.id, "2026-02-01T17:00:00.000Z", 800); // Feb 2, 00:00 WIB

    expect((await getSalesSummary(db!, business.id, { from: "2026-02-01", to: "2026-02-01" })).totalSales).toBe(600);
    expect((await getSalesSummary(db!, business.id, { from: "2026-02-01", to: "2026-02-01" })).orderCount).toBe(2);
    expect((await getSalesSummary(db!, business.id, { from: "2026-01-31", to: "2026-01-31" })).totalSales).toBe(100);
    expect((await getSalesSummary(db!, business.id, { from: "2026-01-31", to: "2026-02-02" })).totalSales).toBe(1500);
    expect(
      (await getSalesByDay(db!, business.id, { from: "2026-01-31", to: "2026-02-02" })).map((d) => [d.day, d.totalSales]),
    ).toEqual([
      ["2026-01-31", 100],
      ["2026-02-01", 600],
      ["2026-02-02", 800],
    ]);
  });

  it("puts an order placed just after midnight on New Year's Day into the new year", async () => {
    const { business } = await seedTestFixture(db!);
    await insertOrder(business.id, "2025-12-31T16:59:59.000Z", 1_000);
    await insertOrder(business.id, "2025-12-31T17:00:00.000Z", 2_000);
    expect((await getSalesSummary(db!, business.id, { from: "2026-01-01", to: "2026-01-01" })).totalSales).toBe(2_000);
    expect((await getSalesSummary(db!, business.id, { from: "2025-12-31", to: "2025-12-31" })).totalSales).toBe(1_000);
  });

  it("filters date-only expenses by calendar date without shifting to the previous UTC day", async () => {
    const { business } = await seedTestFixture(db!);
    await db!.insert(schema.expenses).values([
      { businessId: business.id, category: "rent", amount: 1_000, expenseDate: "2025-12-31" },
      { businessId: business.id, category: "rent", amount: 2_000, expenseDate: "2026-01-01" },
      { businessId: business.id, category: "rent", amount: 4_000, expenseDate: "2026-01-02" },
    ]);
    expect((await getSalesSummary(db!, business.id, { from: "2026-01-01", to: "2026-01-01" })).expensesTotal).toBe(2_000);
    expect((await getSalesSummary(db!, business.id, { from: "2026-01-01", to: "2026-01-02" })).expensesTotal).toBe(6_000);
    const csv = await exportCsv(business.id, "expenses", { from: "2026-01-01", to: "2026-01-01" });
    expect(csv.rows.map((r) => r[0])).toEqual(["2026-01-01"]);
  });

  it("keeps totals above 2^31 exact in summaries, grouped reports, and CSV", async () => {
    const { business } = await seedTestFixture(db!);
    for (let i = 0; i < 3; i++) await insertOrder(business.id, "2026-03-10T03:00:00.000Z", 2_000_000_000);
    await db!.insert(schema.expenses).values([
      { businessId: business.id, category: "rent", amount: 2_000_000_000, expenseDate: "2026-03-10" },
      { businessId: business.id, category: "rent", amount: 2_000_000_000, expenseDate: "2026-03-10", recurring: true },
    ]);
    const range = { from: "2026-03-10", to: "2026-03-10" };

    const summary = await getSalesSummary(db!, business.id, range);
    expect(summary.totalSales).toBe(6_000_000_000);
    expect(summary.averageOrderValue).toBe(2_000_000_000);
    expect(summary.expensesTotal).toBe(4_000_000_000);
    expect(summary.estimatedNetProfit).toBe(2_000_000_000);
    expect((await getSalesByDay(db!, business.id, range))[0].totalSales).toBe(6_000_000_000);
    expect(await getExpenseSummary(db!, business.id, range)).toMatchObject({ total: 4_000_000_000, recurringTotal: 2_000_000_000 });
    expect((await exportCsv(business.id, "sales_by_day", range)).rows).toEqual([["2026-03-10", "3", "6000000000", "0", "6000000000"]]);

    const empty = await getSalesSummary(db!, business.id, { from: "2026-03-11", to: "2026-03-11" });
    expect(empty).toMatchObject({ totalSales: 0, orderCount: 0, averageOrderValue: 0, grossMarginPercentage: null, expensesTotal: 0 });
  });

  it("exports every matching row beyond the old screen limits, matching the paginated screens", async () => {
    const { business, ingredient } = await seedTestFixture(db!);
    const range = { from: "2026-04-01", to: "2026-04-02" };
    const inRange = (i: number) => new Date(Date.parse("2026-03-31T17:00:00.000Z") + i * 1000); // from Apr 1 00:00 WIB
    const outOfRange = new Date("2026-03-31T16:59:59.000Z");
    // Many rows share one timestamp, so page boundaries depend on the id tie-breaker.
    const sharedMoment = inRange(5);

    await db!.insert(schema.wasteRecords).values([
      ...Array.from({ length: 230 }, (_, i) => ({ businessId: business.id, ingredientId: ingredient.id, quantityBaseUnits: "1", reason: "spilled" as const, estimatedCost: i + 1, createdAt: i < 40 ? sharedMoment : inRange(i) })),
      { businessId: business.id, ingredientId: ingredient.id, quantityBaseUnits: "1", reason: "spilled" as const, estimatedCost: 99_999, createdAt: outOfRange },
    ]);
    await db!.insert(schema.purchases).values([
      ...Array.from({ length: 120 }, (_, i) => ({ businessId: business.id, purchaseDate: i % 2 ? "2026-04-01" : "2026-04-02", status: "FINALIZED" as const, totalCost: i + 1 })),
      { businessId: business.id, purchaseDate: "2026-03-31", status: "FINALIZED" as const, totalCost: 99_999 },
    ]);
    await db!.insert(schema.inventoryMovements).values([
      ...Array.from({ length: 520 }, (_, i) => ({ businessId: business.id, ingredientId: ingredient.id, movementType: "MANUAL_ADJUSTMENT_IN" as const, quantityBaseUnits: "1", totalCost: i + 1, sourceType: "test", createdAt: i < 100 ? sharedMoment : inRange(i) })),
      { businessId: business.id, ingredientId: ingredient.id, movementType: "MANUAL_ADJUSTMENT_IN" as const, quantityBaseUnits: "1", totalCost: 99_999, sourceType: "test", createdAt: outOfRange },
    ]);
    await db!.insert(schema.expenses).values([
      ...Array.from({ length: 45 }, (_, i) => ({ businessId: business.id, category: "supplies", amount: i + 1, expenseDate: "2026-04-02" })),
      { businessId: business.id, category: "supplies", amount: 99_999, expenseDate: "2026-04-03" },
    ]);
    for (let i = 0; i < 25; i++) await insertOrder(business.id, inRange(i).toISOString(), i + 1, i % 2 ? "CANCELLED" : "REFUNDED");
    await insertOrder(business.id, outOfRange.toISOString(), 99_999, "CANCELLED");

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const triangle = (n: number) => (n * (n + 1)) / 2;
    const cases = [
      { type: "waste", count: 230, total: triangle(230), screen: () => allPages((w) => listWasteRecords(db!, business.id, { range, ...w })), amount: (r: { estimatedCost: number }) => r.estimatedCost, csvColumn: 4 },
      { type: "purchases", count: 120, total: triangle(120), screen: () => allPages((w) => listPurchases(db!, business.id, { range, ...w })), amount: (r: { totalCost: number }) => r.totalCost, csvColumn: 4 },
      { type: "inventory_movements", count: 520, total: triangle(520), screen: () => allPages((w) => listMovements(db!, business.id, { range, ...w })), amount: (r: { totalCost: number | null }) => r.totalCost ?? 0, csvColumn: 3 },
      { type: "expenses", count: 45, total: triangle(45), screen: () => allPages((w) => listExpensesInRange(db!, business.id, range, w)), amount: (r: { amount: number }) => r.amount, csvColumn: 3 },
      { type: "cancelled_refunded", count: 25, total: triangle(25), screen: () => allPages((w) => getCancelledRefundedOrders(db!, business.id, range, w)), amount: (r: { total: number }) => r.total, csvColumn: 2 },
    ] as const;

    for (const c of cases) {
      const screenRows = (await c.screen()) as Array<{ id: string }>;
      expect(screenRows, c.type).toHaveLength(c.count);
      expect(new Set(screenRows.map((r) => r.id)).size, `${c.type} pages overlap`).toBe(c.count);
      expect(sum(screenRows.map((r) => (c.amount as (row: unknown) => number)(r))), c.type).toBe(c.total);

      const csv = await exportCsv(business.id, c.type, range);
      expect(csv.rows, `${c.type} export`).toHaveLength(c.count);
      expect(sum(csv.rows.map((row) => Number(row[c.csvColumn]))), `${c.type} export total`).toBe(c.total);
    }
  });
});
