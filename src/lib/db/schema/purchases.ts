import { randomUUID } from "node:crypto";
import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses, locations } from "./core";
import { baseUnitEnum, purchaseStatusEnum } from "./enums";
import { ingredients } from "./ingredients";
import { suppliers } from "./suppliers";
import { users } from "./auth";

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  invoiceNumber: text("invoice_number"),
  purchaseDate: date("purchase_date").notNull(),
  status: purchaseStatusEnum("status").notNull().default("DRAFT"),
  // Whole Rupiah; sum of purchase_lines.total_line_cost.
  totalCost: integer("total_cost").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  // Set when a finalized purchase is corrected via reversal + replacement.
  reversedByPurchaseId: uuid("reversed_by_purchase_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseLines = pgTable("purchase_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  purchaseId: uuid("purchase_id")
    .notNull()
    .references(() => purchases.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id").references(() => ingredients.id, {
    onDelete: "set null",
  }),
  ingredientNameSnapshot: text("ingredient_name_snapshot"),
  ingredientBaseUnitSnapshot: baseUnitEnum("ingredient_base_unit_snapshot"),
  // As entered by staff, in whatever unit the supplier sells in.
  quantityPurchased: numeric("quantity_purchased", { precision: 16, scale: 4 }).notNull(),
  purchaseUnit: text("purchase_unit").notNull(), // e.g. "kg", "litre", "box"
  conversionToBaseUnits: numeric("conversion_to_base_units", {
    precision: 16,
    scale: 6,
  }).notNull(),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  // Whole Rupiah for the full line.
  totalLineCost: integer("total_line_cost").notNull(),
  // Exact decimal rate (Rupiah per base unit), not a transacted amount.
  costPerBaseUnit: numeric("cost_per_base_unit", { precision: 16, scale: 6 }).notNull(),
});
