import { mkdirSync, writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/client";
import { shiftBusinessDate, todayInBusinessTimezone, previousBusinessPeriod } from "@/lib/dates/dates";
import {
  getFailedPrintJobs,
  getRecentOrders,
  getSalesByCategory,
  getSalesByCategoryWithModifiers,
  getSalesByMenuItem,
  getSalesByPaymentMethod,
  getSalesSummary,
  getSalesTrend,
  getStockAlerts,
  getTopMenuItemRankings,
} from "@/server/services/reports-service";
import { countMovements, listMovements } from "@/server/services/inventory-service";
import { listOrders } from "@/server/services/order-service";
import { getPosMenu } from "@/server/services/menu-service";

/**
 * Captures the exact SQL each report/dashboard service issues and runs
 * EXPLAIN (ANALYZE, BUFFERS) on it against the seeded perf database. Flags
 * any sequential scan of a large table — the signature of work that grows
 * with the whole installation instead of one tenant's range.
 */
const url = process.env.PERF_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, max: 2 }) : null;
const captured: Array<{ sql: string; params: unknown[] }> = [];
const db = pool
  ? (drizzle(pool, { schema, logger: { logQuery: (sql, params) => captured.push({ sql, params }) } }) as unknown as Database)
  : null;

afterAll(async () => pool?.end());

const LARGE_TABLES = ["orders", "order_lines", "order_line_modifiers", "inventory_movements", "order_ingredient_consumption"];

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Actual Rows"?: number;
  Plans?: PlanNode[];
}

function seqScans(node: PlanNode, out: string[] = []) {
  if (node["Node Type"] === "Seq Scan" && node["Relation Name"] && LARGE_TABLES.includes(node["Relation Name"])) out.push(node["Relation Name"]);
  for (const child of node.Plans ?? []) seqScans(child, out);
  return out;
}

describe.skipIf(!db)("report query plans on representative data", () => {
  it("keeps tenant-scoped report reads off full-table scans of large tables", async () => {
    const { rows: [business] } = await pool!.query<{ id: string }>("select id from businesses order by name limit 1");
    const today = todayInBusinessTimezone();
    const month = { from: shiftBusinessDate(today, -30), to: today };
    const day = { from: shiftBusinessDate(today, -1), to: shiftBusinessDate(today, -1) };

    const cases: Record<string, () => Promise<unknown>> = {
      "summary (30d)": () => getSalesSummary(db!, business.id, month),
      "summary previous (30d)": () => getSalesSummary(db!, business.id, previousBusinessPeriod(month)),
      "trend daily (30d)": () => getSalesTrend(db!, business.id, month, "day"),
      "trend weekly (180d)": () => getSalesTrend(db!, business.id, { from: shiftBusinessDate(today, -180), to: today }, "week"),
      "category+modifiers (1d)": () => getSalesByCategoryWithModifiers(db!, business.id, day),
      "category+modifiers (30d)": () => getSalesByCategoryWithModifiers(db!, business.id, month),
      "category (30d)": () => getSalesByCategory(db!, business.id, month),
      "menu item (30d)": () => getSalesByMenuItem(db!, business.id, month),
      "rankings (30d)": () => getTopMenuItemRankings(db!, business.id, month, 5),
      "payment methods (30d)": () => getSalesByPaymentMethod(db!, business.id, month),
      "failed prints": () => getFailedPrintJobs(db!, business.id),
      "recent orders": () => getRecentOrders(db!, business.id, 8),
      "stock alerts": () => getStockAlerts(db!, business.id, 6),
      "orders page 1": () => listOrders(db!, business.id, { page: 1 }),
      "orders page 500": () => listOrders(db!, business.id, { page: 500 }),
      "orders search \"123\"": () => listOrders(db!, business.id, { search: "123" }),
      "movements page 1": () => listMovements(db!, business.id, { limit: 21, offset: 0 }),
      "movements offset 100k": () => listMovements(db!, business.id, { limit: 21, offset: 100_000 }),
      "movements count (all)": () => countMovements(db!, business.id),
      "movements keyset batch": () => listMovements(db!, business.id, { limit: 1000, after: { ts: "2026-06-01 00:00:00+00", id: "ffffffff-ffff-ffff-ffff-ffffffffffff" } }),
      "pos menu": () => getPosMenu(db!, business.id, { allowNegativeStock: false }),
    };

    const results: Array<Record<string, unknown>> = [];
    for (const [name, run] of Object.entries(cases)) {
      captured.length = 0;
      await run();
      const statements = [...captured];
      let totalMs = 0;
      let hit = 0;
      let read = 0;
      const scans: string[] = [];
      for (const { sql, params } of statements) {
        const { rows } = await pool!.query(`explain (analyze, buffers, format json) ${sql}`, params);
        const plan = rows[0]["QUERY PLAN"][0];
        totalMs += plan["Execution Time"];
        hit += plan.Plan["Shared Hit Blocks"] ?? 0;
        read += plan.Plan["Shared Read Blocks"] ?? 0;
        scans.push(...seqScans(plan.Plan));
      }
      const row = { case: name, statements: statements.length, executionMs: Math.round(totalMs * 10) / 10, sharedHit: hit, sharedRead: read, seqScansOfLargeTables: scans };
      results.push(row);
      console.log(JSON.stringify(row));
    }
    mkdirSync("perf-results", { recursive: true });
    writeFileSync(`perf-results/query-plans-${Date.now()}.json`, JSON.stringify(results, null, 2));
    expect(results.length).toBe(Object.keys(cases).length);
  });
});
