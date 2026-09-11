import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { toCsv } from "@/lib/csv/csv";
import { formatBusinessDateTime, endOfBusinessDay, startOfBusinessDay } from "@/lib/dates/dates";
import { listIngredients } from "@/server/services/ingredient-service";
import { listPurchases } from "@/server/services/purchase-service";
import { listWasteRecords } from "@/server/services/waste-service";
import {
  getCancelledRefundedOrders,
  getExpensesInRange,
  getInventoryMovementsInRange,
  getSalesByCategory,
  getSalesByDay,
  getSalesByMenuItem,
  getSalesByPaymentMethod,
} from "@/server/services/reports-service";

/**
 * CSV exports for every major report (PRD §6.14). Every export re-checks
 * permission and scopes to the caller's business — this is a normal
 * authenticated route, not a public link.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !hasAnyRolePermission(user.roles, "reports:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const range = {
    from: fromParam ? startOfBusinessDay(fromParam) : startOfBusinessDay(new Date().toISOString().slice(0, 10)),
    to: toParam ? endOfBusinessDay(toParam) : endOfBusinessDay(new Date().toISOString().slice(0, 10)),
  };

  let csv: string;
  switch (type) {
    case "sales_by_day": {
      const rows = await getSalesByDay(db, user.businessId, range);
      csv = toCsv(rows, [
        { key: "day", label: "Date" },
        { key: "orderCount", label: "Orders" },
        { key: "totalSales", label: "Total Sales (Rp)" },
        { key: "cogsTotal", label: "COGS (Rp)" },
        { key: "grossProfit", label: "Gross Profit (Rp)" },
      ]);
      break;
    }
    case "sales_by_menu_item": {
      const rows = await getSalesByMenuItem(db, user.businessId, range);
      csv = toCsv(rows, [
        { key: "name", label: "Menu Item" },
        { key: "quantitySold", label: "Quantity Sold" },
        { key: "revenue", label: "Revenue (Rp)" },
        { key: "cogs", label: "COGS (Rp)" },
        { key: "grossProfit", label: "Gross Profit (Rp)" },
      ]);
      break;
    }
    case "sales_by_category": {
      const rows = await getSalesByCategory(db, user.businessId, range);
      csv = toCsv(rows, [
        { key: "categoryName", label: "Category" },
        { key: "quantitySold", label: "Quantity Sold" },
        { key: "revenue", label: "Revenue (Rp)" },
      ]);
      break;
    }
    case "sales_by_payment_method": {
      const rows = await getSalesByPaymentMethod(db, user.businessId, range);
      csv = toCsv(rows, [
        { key: "paymentMethodLabel", label: "Payment Method" },
        { key: "orderCount", label: "Orders" },
        { key: "revenue", label: "Revenue (Rp)" },
      ]);
      break;
    }
    case "cancelled_refunded": {
      const rows = await getCancelledRefundedOrders(db, user.businessId, range);
      csv = toCsv(rows, [
        { key: "orderNumber", label: "Order Number" },
        { key: "status", label: "Status" },
        { key: "total", label: "Total (Rp)" },
        { value: (r) => (r.cancellationReason ?? r.refundReason ?? ""), key: "reason", label: "Reason" },
        { value: (r) => formatBusinessDateTime(r.createdAt), key: "createdAt", label: "Placed At" },
      ]);
      break;
    }
    case "current_stock": {
      const rows = await listIngredients(db, user.businessId, { includeArchived: true });
      csv = toCsv(rows, [
        { key: "name", label: "Ingredient" },
        { key: "baseUnit", label: "Base Unit" },
        { key: "currentQuantityBaseUnits", label: "Current Quantity" },
        { key: "averageCostPerBaseUnit", label: "Avg Cost / Unit (Rp)" },
        { key: "reorderLevelBaseUnits", label: "Reorder Level" },
      ]);
      break;
    }
    case "low_stock": {
      const all = await listIngredients(db, user.businessId);
      const rows = all.filter((i) => i.reorderLevelBaseUnits && Number(i.currentQuantityBaseUnits) <= Number(i.reorderLevelBaseUnits));
      csv = toCsv(rows, [
        { key: "name", label: "Ingredient" },
        { key: "currentQuantityBaseUnits", label: "Current Quantity" },
        { key: "reorderLevelBaseUnits", label: "Reorder Level" },
      ]);
      break;
    }
    case "inventory_movements": {
      const rows = await getInventoryMovementsInRange(db, user.businessId, range);
      csv = toCsv(rows, [
        { value: (r) => formatBusinessDateTime(r.createdAt), key: "createdAt", label: "When" },
        { key: "movementType", label: "Type" },
        { key: "quantityBaseUnits", label: "Quantity" },
        { key: "totalCost", label: "Value (Rp)" },
        { key: "reason", label: "Reason" },
      ]);
      break;
    }
    case "purchases": {
      const rows = await listPurchases(db, user.businessId);
      csv = toCsv(rows, [
        { key: "purchaseDate", label: "Date" },
        { key: "supplierName", label: "Supplier" },
        { key: "invoiceNumber", label: "Invoice" },
        { key: "status", label: "Status" },
        { key: "totalCost", label: "Total (Rp)" },
      ]);
      break;
    }
    case "waste": {
      const rows = await listWasteRecords(db, user.businessId);
      csv = toCsv(rows, [
        { value: (r) => formatBusinessDateTime(r.createdAt), key: "createdAt", label: "When" },
        { key: "ingredientName", label: "Ingredient" },
        { key: "quantityBaseUnits", label: "Quantity" },
        { key: "reason", label: "Reason" },
        { key: "estimatedCost", label: "Estimated Cost (Rp)" },
      ]);
      break;
    }
    case "expenses": {
      const rows = await getExpensesInRange(db, user.businessId, range);
      csv = toCsv(rows, [
        { key: "expenseDate", label: "Date" },
        { key: "category", label: "Category" },
        { key: "payee", label: "Payee" },
        { key: "amount", label: "Amount (Rp)" },
      ]);
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}.csv"`,
    },
  });
}
