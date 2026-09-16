import { randomUUID } from "node:crypto";
import { boolean, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { businesses } from "./core";
import { baseUnitEnum, ingredientDisplayUnitEnum } from "./enums";
import { suppliers } from "./suppliers";

/**
 * Quantities are stored as exact decimal (`numeric`), never `float`, since
 * fractional base-unit quantities are expected (e.g. 17.5g). Money-like
 * "cost per base unit" is also `numeric` (an exact decimal rate) rather than
 * integer Rupiah, because it is a derived unit rate, not a transacted money
 * amount — the PRD explicitly allows "integer-safe arithmetic or a decimal
 * numeric type" for the weighted-average cost calculation. Every amount
 * actually charged or recorded as a money total (order totals, expense
 * amounts, COGS snapshots, etc.) stays a plain integer Rupiah column.
 */
export const ingredients = pgTable("ingredients", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  sku: text("sku"),
  category: text("category"),
  baseUnit: baseUnitEnum("base_unit").notNull(),
  // Null means the base unit's own (g / ml / pc). See ingredientDisplayUnitEnum.
  displayUnit: ingredientDisplayUnitEnum("display_unit"),
  currentQuantityBaseUnits: numeric("current_quantity_base_units", {
    precision: 16,
    scale: 4,
  })
    .notNull()
    .default("0"),
  reorderLevelBaseUnits: numeric("reorder_level_base_units", { precision: 16, scale: 4 }),
  targetStockBaseUnits: numeric("target_stock_base_units", { precision: 16, scale: 4 }),
  averageCostPerBaseUnit: numeric("average_cost_per_base_unit", {
    precision: 16,
    scale: 6,
  })
    .notNull()
    .default("0"),
  preferredSupplierId: uuid("preferred_supplier_id").references(() => suppliers.id, {
    onDelete: "set null",
  }),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("ingredients_business_id_idx").on(table.businessId)]);
