import { randomUUID } from "node:crypto";
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses, locations } from "./core";
import { baseUnitEnum, movementTypeEnum, stockCountStatusEnum, wasteReasonEnum } from "./enums";
import { ingredients } from "./ingredients";
import { users } from "./auth";

/**
 * Append-only stock ledger. Rows are never updated or deleted — every
 * quantity change, in either direction, is its own row. `quantityBaseUnits`
 * is signed: positive for inbound movements, negative for outbound ones,
 * so that `SUM(quantity_base_units)` per ingredient reconstructs current
 * stock and doubles as the reconciliation check against the cached value
 * on `ingredients.current_quantity_base_units`.
 */
export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
  ingredientId: uuid("ingredient_id").references(() => ingredients.id, {
    onDelete: "set null",
  }),
  // Snapshot columns, not a join: an ingredient can be deleted outright and
  // `ingredient_id` then goes NULL, so the row has to be able to say what it
  // was about on its own.
  ingredientNameSnapshot: text("ingredient_name_snapshot"),
  ingredientBaseUnitSnapshot: baseUnitEnum("ingredient_base_unit_snapshot"),
  movementType: movementTypeEnum("movement_type").notNull(),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  // Cost rate applied to this movement (exact decimal, Rupiah per base unit).
  unitCost: numeric("unit_cost", { precision: 16, scale: 6 }),
  // Whole Rupiah total value of this movement, where applicable.
  totalCost: integer("total_cost"),
  // e.g. 'order', 'purchase', 'waste_record', 'stock_count', 'manual'
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  // Points at the movement this one reverses/compensates, if any.
  relatedMovementId: uuid("related_movement_id"),
  reason: text("reason"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Ledger pages and date-ranged movement reports.
  index("inventory_movements_business_created_at_idx").on(table.businessId, table.createdAt, table.id),
  // Per-ingredient history, and the ON DELETE SET NULL scan when an ingredient is deleted.
  index("inventory_movements_ingredient_created_at_idx").on(table.ingredientId, table.createdAt),
]);

export const stockCounts = pgTable("stock_counts", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
  status: stockCountStatusEnum("status").notNull().default("OPEN"),
  countedBy: uuid("counted_by").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("stock_counts_business_id_idx").on(table.businessId)]);

export const stockCountLines = pgTable("stock_count_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  stockCountId: uuid("stock_count_id")
    .notNull()
    .references(() => stockCounts.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id").references(() => ingredients.id, {
    onDelete: "set null",
  }),
  ingredientNameSnapshot: text("ingredient_name_snapshot"),
  ingredientBaseUnitSnapshot: baseUnitEnum("ingredient_base_unit_snapshot"),
  systemQuantity: numeric("system_quantity", { precision: 16, scale: 4 }).notNull(),
  countedQuantity: numeric("counted_quantity", { precision: 16, scale: 4 }).notNull(),
  differenceQuantity: numeric("difference_quantity", { precision: 16, scale: 4 }).notNull(),
}, (table) => [
  index("stock_count_lines_stock_count_id_idx").on(table.stockCountId),
  index("stock_count_lines_ingredient_id_idx").on(table.ingredientId),
]);

export const wasteRecords = pgTable("waste_records", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
  ingredientId: uuid("ingredient_id").references(() => ingredients.id, {
    onDelete: "set null",
  }),
  ingredientNameSnapshot: text("ingredient_name_snapshot"),
  ingredientBaseUnitSnapshot: baseUnitEnum("ingredient_base_unit_snapshot"),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  reason: wasteReasonEnum("reason").notNull(),
  // Whole Rupiah, computed from the ingredient's average cost at time of entry.
  estimatedCost: integer("estimated_cost").notNull(),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("waste_records_business_created_at_idx").on(table.businessId, table.createdAt, table.id),
  index("waste_records_ingredient_id_idx").on(table.ingredientId),
]);
