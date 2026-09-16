import { randomUUID } from "node:crypto";
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses, locations } from "./core";
import { baseUnitEnum, orderStatusEnum, orderTypeEnum } from "./enums";
import { ingredients } from "./ingredients";
import { menuItems, menuItemVariants, modifierOptions } from "./menu";
import { inventoryMovements } from "./inventory";
import { users } from "./auth";

/**
 * Every money column here is a plain integer Rupiah snapshot, taken at
 * submission time. Nothing on a submitted order is recomputed from live
 * menu/recipe/cost data later — that's the whole point of "historical
 * orders must not change when the menu item is edited later."
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    orderNumber: text("order_number").notNull(),
    status: orderStatusEnum("status").notNull().default("DRAFT"),
    orderType: orderTypeEnum("order_type").notNull().default("dine_in"),
    tableLabel: text("table_label"),
    subtotal: integer("subtotal").notNull().default(0),
    discountTotal: integer("discount_total").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    serviceChargeTotal: integer("service_charge_total").notNull().default(0),
    total: integer("total").notNull().default(0),
    cogsTotal: integer("cogs_total").notNull().default(0),
    grossProfit: integer("gross_profit").notNull().default(0),
    // Stored as an exact decimal percentage (e.g. 62.35), not a money value.
    grossMarginPercentage: numeric("gross_margin_percentage", { precision: 6, scale: 2 }),
    paymentMethodLabel: text("payment_method_label"),
    // Cash tendered by the customer and the change handed back, both whole
    // Rupiah snapshots. Null on non-cash orders, and on cash orders taken
    // before the POS started requiring the amount — null means "not
    // recorded", never "zero".
    cashReceived: integer("cash_received"),
    changeDue: integer("change_due"),
    notes: text("notes"),
    // Idempotency key supplied by the client for the submit-order action.
    // Unique per business so a retried submission returns the same order
    // instead of creating a second one.
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancellationReason: text("cancellation_reason"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundedBy: uuid("refunded_by").references(() => users.id, { onDelete: "set null" }),
    refundReason: text("refund_reason"),
  },
  (table) => [
    uniqueIndex("orders_business_order_number_idx").on(table.businessId, table.orderNumber),
    uniqueIndex("orders_business_idempotency_key_idx").on(
      table.businessId,
      table.idempotencyKey,
    ),
    // Order lists, date-ranged reports and recent orders: tenant filter,
    // newest first, with id as the pagination tie-breaker.
    index("orders_business_created_at_idx").on(table.businessId, table.createdAt, table.id),
  ],
);

/**
 * Per-business order-number allocator. Incrementing this row replaces the
 * old COUNT(*) + 1 — it's atomic, gapless (the increment rolls back with a
 * failed submission), and its row lock is only held from number allocation
 * to commit rather than across the whole checkout.
 */
export const orderNumberCounters = pgTable("order_number_counters", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "restrict" }),
  lastNumber: integer("last_number").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderLines = pgTable("order_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  menuItemId: uuid("menu_item_id").references(() => menuItems.id, { onDelete: "set null" }),
  menuItemVariantId: uuid("menu_item_variant_id").references(() => menuItemVariants.id, {
    onDelete: "set null",
  }),
  itemNameSnapshot: text("item_name_snapshot").notNull(),
  variantNameSnapshot: text("variant_name_snapshot"),
  // Snapshot, not a join, for the same reason as the name and price above:
  // menu items can be deleted outright, and `menu_item_id` is ON DELETE SET
  // NULL. Without this column the sales-by-category report would silently
  // re-attribute a deleted item's past revenue to "Uncategorized".
  // Null means the item genuinely had no category when it was sold.
  categoryNameSnapshot: text("category_name_snapshot"),
  quantity: integer("quantity").notNull(),
  unitPriceSnapshot: integer("unit_price_snapshot").notNull(),
  lineTotal: integer("line_total").notNull(),
  cogsSnapshot: integer("cogs_snapshot").notNull().default(0),
  grossProfitSnapshot: integer("gross_profit_snapshot").notNull().default(0),
  notes: text("notes"),
}, (table) => [
  index("order_lines_order_id_idx").on(table.orderId),
  // ON DELETE SET NULL scans when a menu item / variant is deleted.
  index("order_lines_menu_item_id_idx").on(table.menuItemId),
  index("order_lines_variant_id_idx").on(table.menuItemVariantId),
]);

export const orderLineModifiers = pgTable("order_line_modifiers", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  orderLineId: uuid("order_line_id")
    .notNull()
    .references(() => orderLines.id, { onDelete: "cascade" }),
  modifierOptionId: uuid("modifier_option_id").references(() => modifierOptions.id, {
    onDelete: "set null",
  }),
  modifierNameSnapshot: text("modifier_name_snapshot").notNull(),
  priceAdjustmentSnapshot: integer("price_adjustment_snapshot").notNull().default(0),
  cogsAdjustmentSnapshot: integer("cogs_adjustment_snapshot").notNull().default(0),
}, (table) => [
  index("order_line_modifiers_order_line_id_idx").on(table.orderLineId),
  index("order_line_modifiers_option_id_idx").on(table.modifierOptionId),
]);

/**
 * Explicit audit trail of the recipe calculation behind an order: exactly
 * which ingredient, how much, at what cost, and which inventory movement
 * it produced. This is what makes "compare calculated COGS with manual
 * calculation" possible during pilot testing.
 */
export const orderIngredientConsumption = pgTable("order_ingredient_consumption", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  orderLineId: uuid("order_line_id")
    .notNull()
    .references(() => orderLines.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id").references(() => ingredients.id, {
    onDelete: "set null",
  }),
  // Snapshot columns, not a join: an ingredient can be deleted outright and
  // `ingredient_id` then goes NULL, so the row has to be able to say what it
  // was about on its own.
  ingredientNameSnapshot: text("ingredient_name_snapshot"),
  ingredientBaseUnitSnapshot: baseUnitEnum("ingredient_base_unit_snapshot"),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  unitCostSnapshot: numeric("unit_cost_snapshot", { precision: 16, scale: 6 }).notNull(),
  totalCost: integer("total_cost").notNull(),
  inventoryMovementId: uuid("inventory_movement_id").references(
    () => inventoryMovements.id,
    { onDelete: "set null" },
  ),
}, (table) => [
  index("order_ingredient_consumption_order_id_idx").on(table.orderId),
  index("order_ingredient_consumption_order_line_id_idx").on(table.orderLineId),
  index("order_ingredient_consumption_ingredient_id_idx").on(table.ingredientId),
  // The inventory ledger looks up which order line caused each sale movement.
  index("order_ingredient_consumption_movement_id_idx").on(table.inventoryMovementId),
]);
