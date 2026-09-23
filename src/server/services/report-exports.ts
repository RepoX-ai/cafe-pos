import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import type { Database } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { csvHeader, csvRow, type CsvColumn } from "@/lib/csv/csv";
import { formatBusinessDateTime, type BusinessDateRange } from "@/lib/dates/dates";
import { log } from "@/lib/observability/log";
import { ServiceError } from "./errors";
import { countExpensesInRange, listExpensesInRange } from "./expense-service";
import { listIngredients, listLowStockIngredients } from "./ingredient-service";
import { countMovements, listMovements } from "./inventory-service";
import { countPurchases, listPurchases } from "./purchase-service";
import {
  countCancelledRefundedOrders,
  getCancelledRefundedOrders,
  getSalesByCategory,
  getSalesByDay,
  getSalesByMenuItem,
  getSalesByPaymentMethod,
} from "./reports-service";
import { countWasteRecords, listWasteRecords } from "./waste-service";

export const REPORT_TYPES = [
  "sales_by_day",
  "sales_by_menu_item",
  "sales_by_category",
  "sales_by_payment_method",
  "cancelled_refunded",
  "current_stock",
  "low_stock",
  "inventory_movements",
  "purchases",
  "waste",
  "expenses",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(value);
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  sales_by_day: "Sales by day",
  sales_by_menu_item: "Sales by menu item",
  sales_by_category: "Sales by category",
  sales_by_payment_method: "Sales by payment method",
  cancelled_refunded: "Cancelled / refunded orders",
  current_stock: "Current stock",
  low_stock: "Low stock",
  inventory_movements: "Inventory movements",
  purchases: "Purchases",
  waste: "Waste",
  expenses: "Expenses",
};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface ExportLimits {
  /** Rows a row-level export may contain; larger requests are refused before streaming starts. */
  maxRows: number;
  /** Wall-clock ceiling for one export, including time spent waiting on a slow reader. */
  maxDurationMs: number;
  /** Exports running at once across every app instance (advisory-lock slots). */
  maxConcurrent: number;
  batchSize: number;
  statementTimeoutMs: number;
  /** How long the snapshot may sit idle between batches while the reader is slow. */
  idleTimeoutMs: number;
  /** Advisory-lock namespace for the concurrency slots (tests isolate themselves with their own). */
  slotNamespace?: number;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max} (got "${raw}").`);
  }
  return value;
}

export function exportLimitsFromEnv(): ExportLimits {
  return {
    maxRows: envInt("EXPORT_MAX_ROWS", 100_000, 1, 5_000_000),
    maxDurationMs: envInt("EXPORT_MAX_SECONDS", 120, 5, 3_600) * 1000,
    maxConcurrent: envInt("EXPORT_MAX_CONCURRENT", 2, 1, 20),
    batchSize: envInt("EXPORT_BATCH_SIZE", 1000, 50, 10_000),
    statementTimeoutMs: envInt("DATABASE_REPORT_STATEMENT_TIMEOUT_MS", 30_000, 100, 600_000),
    idleTimeoutMs: envInt("DATABASE_REPORT_IDLE_IN_TRANSACTION_TIMEOUT_MS", 60_000, 1_000, 3_600_000),
  };
}

/** Refused before any CSV byte is sent; `status` is the HTTP status the route returns. */
export class ExportRejectedError extends ServiceError {
  constructor(
    message: string,
    readonly status: 413 | 429,
  ) {
    super(message);
  }
}

export class ExportTimeoutError extends Error {}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

type CursorRow = { id: string; cursorTs: string };
type Source<T> =
  | { kind: "all"; columns: CsvColumn<T>[]; all: (db: Database) => Promise<T[]> }
  | {
      kind: "keyset";
      columns: CsvColumn<T>[];
      count: (db: Database) => Promise<number>;
      /** Next batch strictly after `after` (the previous batch's last row), in the list's own order. */
      batch: (db: Database, limit: number, after: T | undefined) => Promise<T[]>;
    };

const timeCursor = (row: CursorRow | undefined) => (row ? { ts: row.cursorTs, id: row.id } : undefined);

// Every source uses the same service query and filters as the matching
// report screen; the row-level ones page with a keyset cursor, not OFFSET.
function sourceFor(type: ReportType, businessId: string, range: BusinessDateRange, cap: number): Source<Record<string, unknown>> {
  switch (type) {
    case "sales_by_day":
      return {
        kind: "all",
        all: (tx) => getSalesByDay(tx, businessId, range),
        columns: [
          { key: "day", label: "Date" },
          { key: "orderCount", label: "Orders" },
          { key: "totalSales", label: "Total Sales (Rp)" },
          { key: "cogsTotal", label: "COGS (Rp)" },
          { key: "grossProfit", label: "Gross Profit (Rp)" },
        ],
      };
    case "sales_by_menu_item":
      return {
        kind: "all",
        all: (tx) => getSalesByMenuItem(tx, businessId, range),
        columns: [
          { key: "name", label: "Menu Item" },
          { key: "quantitySold", label: "Quantity Sold" },
          { key: "revenue", label: "Revenue (Rp)" },
          { key: "cogs", label: "COGS (Rp)" },
          { key: "grossProfit", label: "Gross Profit (Rp)" },
        ],
      };
    case "sales_by_category":
      return {
        kind: "all",
        all: (tx) => getSalesByCategory(tx, businessId, range),
        columns: [
          { key: "categoryName", label: "Category" },
          { key: "quantitySold", label: "Quantity Sold" },
          { key: "revenue", label: "Revenue (Rp)" },
        ],
      };
    case "sales_by_payment_method":
      return {
        kind: "all",
        all: (tx) => getSalesByPaymentMethod(tx, businessId, range),
        columns: [
          { key: "paymentMethodLabel", label: "Payment Method" },
          { key: "orderCount", label: "Orders" },
          { key: "revenue", label: "Revenue (Rp)" },
        ],
      };
    case "cancelled_refunded":
      return {
        kind: "keyset",
        count: (tx) => countCancelledRefundedOrders(tx, businessId, range, cap),
        batch: (tx, limit, after) => getCancelledRefundedOrders(tx, businessId, range, { limit, after: timeCursor(after as CursorRow) }),
        columns: [
          { key: "orderNumber", label: "Order Number" },
          { key: "status", label: "Status" },
          { key: "total", label: "Total (Rp)" },
          { value: (r) => (r.cancellationReason ?? r.refundReason ?? "") as string, key: "reason", label: "Reason" },
          { value: (r) => formatBusinessDateTime(r.createdAt as Date), key: "createdAt", label: "Placed At" },
        ],
      };
    case "current_stock":
      return {
        kind: "all",
        all: (tx) => listIngredients(tx, businessId, { includeArchived: true }),
        columns: [
          { key: "name", label: "Ingredient" },
          { key: "baseUnit", label: "Base Unit" },
          { key: "currentQuantityBaseUnits", label: "Current Quantity" },
          { key: "averageCostPerBaseUnit", label: "Avg Cost / Unit (Rp)" },
          { key: "reorderLevelBaseUnits", label: "Reorder Level" },
        ],
      };
    case "low_stock":
      return {
        kind: "all",
        all: (tx) => listLowStockIngredients(tx, businessId),
        columns: [
          { key: "name", label: "Ingredient" },
          { key: "currentQuantityBaseUnits", label: "Current Quantity" },
          { key: "reorderLevelBaseUnits", label: "Reorder Level" },
        ],
      };
    case "inventory_movements":
      return {
        kind: "keyset",
        count: (tx) => countMovements(tx, businessId, { range, cap }),
        batch: (tx, limit, after) => listMovements(tx, businessId, { range, limit, after: timeCursor(after as CursorRow) }),
        columns: [
          { value: (r) => formatBusinessDateTime(r.createdAt as Date), key: "createdAt", label: "When" },
          { key: "movementType", label: "Type" },
          { key: "quantityBaseUnits", label: "Quantity" },
          { key: "totalCost", label: "Value (Rp)" },
          { key: "reason", label: "Reason" },
        ],
      };
    case "purchases":
      return {
        kind: "keyset",
        count: (tx) => countPurchases(tx, businessId, { range, cap }),
        batch: (tx, limit, after) => listPurchases(tx, businessId, { range, limit, after: timeCursor(after as CursorRow) }),
        columns: [
          { key: "purchaseDate", label: "Date" },
          { key: "supplierName", label: "Supplier" },
          { key: "invoiceNumber", label: "Invoice" },
          { key: "status", label: "Status" },
          { key: "totalCost", label: "Total (Rp)" },
        ],
      };
    case "waste":
      return {
        kind: "keyset",
        count: (tx) => countWasteRecords(tx, businessId, { range, cap }),
        batch: (tx, limit, after) => listWasteRecords(tx, businessId, { range, limit, after: timeCursor(after as CursorRow) }),
        columns: [
          { value: (r) => formatBusinessDateTime(r.createdAt as Date), key: "createdAt", label: "When" },
          { key: "ingredientName", label: "Ingredient" },
          { key: "quantityBaseUnits", label: "Quantity" },
          { key: "reason", label: "Reason" },
          { key: "estimatedCost", label: "Estimated Cost (Rp)" },
        ],
      };
    case "expenses":
      return {
        kind: "keyset",
        count: (tx) => countExpensesInRange(tx, businessId, range, cap),
        batch: (tx, limit, after) =>
          listExpensesInRange(tx, businessId, range, {
            limit,
            after: after ? { date: after.expenseDate as string, ts: after.cursorTs as string, id: after.id as string } : undefined,
          }),
        columns: [
          { key: "expenseDate", label: "Date" },
          { key: "category", label: "Category" },
          { key: "payee", label: "Payee" },
          { key: "amount", label: "Amount (Rp)" },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Export session
// ---------------------------------------------------------------------------

const EXPORT_BUSINESS_LOCK = 730_214;
const EXPORT_SLOT_LOCK = 730_215;

export interface ReportExport {
  /** CSV text chunks, produced only as fast as they are consumed. */
  chunks: AsyncGenerator<string, void, undefined>;
  /** Rows the export will contain (row-level reports), or null for grouped reports. */
  expectedRows: number | null;
}

/**
 * Opens one CSV export.
 *
 * Consistency: everything is read inside one READ ONLY, REPEATABLE READ
 * transaction, so the file is exactly the database as of the export's first
 * query — rows committed while it streams are not included, and nothing is
 * skipped or repeated between batches. Row-level reports page with a keyset
 * cursor on (timestamp, id), so batch N costs the same as batch 1.
 *
 * Resources: the export holds one connection from the *reports* pool (never
 * checkout's), at most one export per business and `maxConcurrent` across
 * every instance run at once (transaction-scoped advisory locks, released
 * however the transaction ends), and the row count is checked before the
 * first byte is sent. The generator only queries when the next chunk is
 * pulled, so a slow reader slows the export instead of buffering it in
 * memory; the snapshot then sits idle until `idleTimeoutMs`, and the whole
 * export is cut off at `maxDurationMs`. Completion, an error, a timeout or
 * the reader cancelling all end in ROLLBACK and the connection's release
 * (destroyed rather than reused if it failed mid-query).
 */
export async function openReportExport(
  pool: Pool,
  businessId: string,
  type: ReportType,
  range: BusinessDateRange,
  limits: ExportLimits = exportLimitsFromEnv(),
): Promise<ReportExport> {
  const client = await pool.connect();
  let released = false;
  // Backstop for a stream that is opened but never read to the end nor
  // cancelled: the connection is destroyed rather than held forever.
  const watchdog = setTimeout(() => {
    if (released) return;
    log("warn", "export.abandoned", { type, businessId });
    void release(true);
  }, limits.maxDurationMs + 5_000);
  watchdog.unref?.();
  const release = async (broken: boolean) => {
    if (released) return;
    released = true;
    clearTimeout(watchdog);
    if (!broken) {
      try {
        await client.query("rollback");
      } catch {
        broken = true;
      }
    }
    client.release(broken ? true : undefined);
  };

  try {
    await client.query("begin isolation level repeatable read read only");
    // SET LOCAL rather than connection settings: works through transaction
    // poolers too, and ends with this transaction.
    await client.query(`set local statement_timeout = ${limits.statementTimeoutMs}`);
    await client.query(`set local idle_in_transaction_session_timeout = ${limits.idleTimeoutMs}`);

    const [{ ok: businessFree }] = (
      await client.query<{ ok: boolean }>("select pg_try_advisory_xact_lock($1::int, hashtext($2)) as ok", [EXPORT_BUSINESS_LOCK, businessId])
    ).rows;
    if (!businessFree) {
      throw new ExportRejectedError("Another export for this business is still running. Try again when it finishes.", 429);
    }
    // One slot, tried one at a time: a set-returning query would evaluate
    // the try-lock for every slot and take all of them.
    let gotSlot = false;
    for (let slot = 0; slot < limits.maxConcurrent && !gotSlot; slot++) {
      const { rows } = await client.query<{ ok: boolean }>("select pg_try_advisory_xact_lock($1::int, $2::int) as ok", [limits.slotNamespace ?? EXPORT_SLOT_LOCK, slot]);
      gotSlot = rows[0].ok;
    }
    if (!gotSlot) {
      throw new ExportRejectedError("The server is busy with other exports. Try again in a minute.", 429);
    }

    const tx = drizzle(client as PoolClient, { schema }) as unknown as Database;
    // Counted up to one past the cap: enough to refuse, without scanning an
    // unbounded history just to report its size.
    const source = sourceFor(type, businessId, range, limits.maxRows);

    let expectedRows: number | null = null;
    if (source.kind === "keyset") {
      expectedRows = await source.count(tx);
      if (expectedRows > limits.maxRows) {
        throw new ExportRejectedError(
          `This export has more than ${limits.maxRows.toLocaleString("en")} rows, over the export limit. Narrow the date range and export it in parts.`,
          413,
        );
      }
    }

    const deadline = Date.now() + limits.maxDurationMs;
    const startedAt = Date.now();

    async function* chunks(): AsyncGenerator<string, void, undefined> {
      let broken = false;
      let rowsWritten = 0;
      let outcome = "cancelled";
      try {
        yield csvHeader(source.columns);
        if (source.kind === "all") {
          const rows = await source.all(tx);
          rowsWritten = rows.length;
          if (rows.length > 0) yield rows.map((row) => `\r\n${csvRow(row, source.columns)}`).join("");
        } else {
          let after: Record<string, unknown> | undefined;
          for (;;) {
            if (Date.now() > deadline) throw new ExportTimeoutError(`Export exceeded ${limits.maxDurationMs / 1000}s`);
            const rows = await source.batch(tx, limits.batchSize, after);
            if (rows.length === 0) break;
            rowsWritten += rows.length;
            after = rows[rows.length - 1];
            yield rows.map((row) => `\r\n${csvRow(row, source.columns)}`).join("");
            if (rows.length < limits.batchSize) break;
          }
        }
        outcome = "completed";
      } catch (error) {
        broken = !(error instanceof ExportTimeoutError);
        outcome = error instanceof ExportTimeoutError ? "timeout" : "failed";
        throw error;
      } finally {
        await release(broken);
        log(outcome === "completed" ? "info" : "warn", "export.finished", {
          type,
          businessId,
          outcome,
          rows: rowsWritten,
          ms: Date.now() - startedAt,
        });
      }
    }

    // `return()` on a generator that was never started completes it without
    // running its `finally` — so a stream cancelled before its first pull
    // would keep the connection. Release explicitly as well (idempotent).
    const generator = chunks();
    const originalReturn = generator.return.bind(generator);
    generator.return = async (value) => {
      try {
        return await originalReturn(value);
      } finally {
        await release(false);
      }
    };
    return { chunks: generator, expectedRows };
  } catch (error) {
    await release(!(error instanceof ExportRejectedError));
    throw error;
  }
}
