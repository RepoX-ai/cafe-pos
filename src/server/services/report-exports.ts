import type { Database } from "@/lib/db/client";
import { csvHeader, csvRow, type CsvColumn } from "@/lib/csv/csv";
import { formatBusinessDateTime, type BusinessDateRange } from "@/lib/dates/dates";
import { listExpensesInRange } from "./expense-service";
import { listIngredients, listLowStockIngredients } from "./ingredient-service";
import { listMovements } from "./inventory-service";
import { listPurchases } from "./purchase-service";
import {
  getCancelledRefundedOrders,
  getSalesByCategory,
  getSalesByDay,
  getSalesByMenuItem,
  getSalesByPaymentMethod,
} from "./reports-service";
import { listWasteRecords } from "./waste-service";

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

type Source<T> =
  | { columns: CsvColumn<T>[]; all: (db: Database) => Promise<T[]> }
  | { columns: CsvColumn<T>[]; batch: (db: Database, window: { limit: number; offset: number }) => Promise<T[]> };

/**
 * Writes a complete CSV export: grouped reports in one read, row-level
 * reports in bounded batches. Everything runs in one read-only REPEATABLE
 * READ transaction, so offset batches see a single snapshot and rows written
 * mid-export can't be skipped or repeated. Every source uses the same
 * service query (and filters) as the matching report screen.
 */
export async function writeReportCsv(
  db: Database,
  businessId: string,
  type: ReportType,
  range: BusinessDateRange,
  write: (chunk: string) => void,
  opts: { batchSize?: number } = {},
) {
  const batchSize = opts.batchSize ?? 1000;

  async function emit<T extends Record<string, unknown>>(source: Source<T>) {
    await db.transaction(
      async (tx) => {
        write(csvHeader(source.columns));
        if ("all" in source) {
          const rows = await source.all(tx);
          if (rows.length > 0) write(rows.map((row) => `\r\n${csvRow(row, source.columns)}`).join(""));
          return;
        }
        for (let offset = 0; ; offset += batchSize) {
          const rows = await source.batch(tx, { limit: batchSize, offset });
          if (rows.length > 0) write(rows.map((row) => `\r\n${csvRow(row, source.columns)}`).join(""));
          if (rows.length < batchSize) break;
        }
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  switch (type) {
    case "sales_by_day":
      return emit({
        all: (tx) => getSalesByDay(tx, businessId, range),
        columns: [
          { key: "day", label: "Date" },
          { key: "orderCount", label: "Orders" },
          { key: "totalSales", label: "Total Sales (Rp)" },
          { key: "cogsTotal", label: "COGS (Rp)" },
          { key: "grossProfit", label: "Gross Profit (Rp)" },
        ],
      });
    case "sales_by_menu_item":
      return emit({
        all: (tx) => getSalesByMenuItem(tx, businessId, range),
        columns: [
          { key: "name", label: "Menu Item" },
          { key: "quantitySold", label: "Quantity Sold" },
          { key: "revenue", label: "Revenue (Rp)" },
          { key: "cogs", label: "COGS (Rp)" },
          { key: "grossProfit", label: "Gross Profit (Rp)" },
        ],
      });
    case "sales_by_category":
      return emit({
        all: (tx) => getSalesByCategory(tx, businessId, range),
        columns: [
          { key: "categoryName", label: "Category" },
          { key: "quantitySold", label: "Quantity Sold" },
          { key: "revenue", label: "Revenue (Rp)" },
        ],
      });
    case "sales_by_payment_method":
      return emit({
        all: (tx) => getSalesByPaymentMethod(tx, businessId, range),
        columns: [
          { key: "paymentMethodLabel", label: "Payment Method" },
          { key: "orderCount", label: "Orders" },
          { key: "revenue", label: "Revenue (Rp)" },
        ],
      });
    case "cancelled_refunded":
      return emit({
        batch: (tx, window) => getCancelledRefundedOrders(tx, businessId, range, window),
        columns: [
          { key: "orderNumber", label: "Order Number" },
          { key: "status", label: "Status" },
          { key: "total", label: "Total (Rp)" },
          { value: (r) => r.cancellationReason ?? r.refundReason ?? "", key: "reason", label: "Reason" },
          { value: (r) => formatBusinessDateTime(r.createdAt), key: "createdAt", label: "Placed At" },
        ],
      });
    case "current_stock":
      return emit({
        all: (tx) => listIngredients(tx, businessId, { includeArchived: true }),
        columns: [
          { key: "name", label: "Ingredient" },
          { key: "baseUnit", label: "Base Unit" },
          { key: "currentQuantityBaseUnits", label: "Current Quantity" },
          { key: "averageCostPerBaseUnit", label: "Avg Cost / Unit (Rp)" },
          { key: "reorderLevelBaseUnits", label: "Reorder Level" },
        ],
      });
    case "low_stock":
      return emit({
        all: (tx) => listLowStockIngredients(tx, businessId),
        columns: [
          { key: "name", label: "Ingredient" },
          { key: "currentQuantityBaseUnits", label: "Current Quantity" },
          { key: "reorderLevelBaseUnits", label: "Reorder Level" },
        ],
      });
    case "inventory_movements":
      return emit({
        batch: (tx, window) => listMovements(tx, businessId, { range, ...window }),
        columns: [
          { value: (r) => formatBusinessDateTime(r.createdAt), key: "createdAt", label: "When" },
          { key: "movementType", label: "Type" },
          { key: "quantityBaseUnits", label: "Quantity" },
          { key: "totalCost", label: "Value (Rp)" },
          { key: "reason", label: "Reason" },
        ],
      });
    case "purchases":
      return emit({
        batch: (tx, window) => listPurchases(tx, businessId, { range, ...window }),
        columns: [
          { key: "purchaseDate", label: "Date" },
          { key: "supplierName", label: "Supplier" },
          { key: "invoiceNumber", label: "Invoice" },
          { key: "status", label: "Status" },
          { key: "totalCost", label: "Total (Rp)" },
        ],
      });
    case "waste":
      return emit({
        batch: (tx, window) => listWasteRecords(tx, businessId, { range, ...window }),
        columns: [
          { value: (r) => formatBusinessDateTime(r.createdAt), key: "createdAt", label: "When" },
          { key: "ingredientName", label: "Ingredient" },
          { key: "quantityBaseUnits", label: "Quantity" },
          { key: "reason", label: "Reason" },
          { key: "estimatedCost", label: "Estimated Cost (Rp)" },
        ],
      });
    case "expenses":
      return emit({
        batch: (tx, window) => listExpensesInRange(tx, businessId, range, window),
        columns: [
          { key: "expenseDate", label: "Date" },
          { key: "category", label: "Category" },
          { key: "payee", label: "Payee" },
          { key: "amount", label: "Amount (Rp)" },
        ],
      });
  }
}
