import { randomUUID } from "node:crypto";
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  logoUrl: text("logo_url"),
  address: text("address"),
  phone: text("phone"),
  currency: text("currency").notNull().default("IDR"),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  taxConfig: text("tax_config"), // JSON-encoded tax rules; see lib/money for shape
  receiptFooter: text("receipt_footer"),
  orderNumberPrefix: text("order_number_prefix").notNull().default("ORD"),
  defaultPrinterId: uuid("default_printer_id"),
  serviceChargePercent: text("service_charge_percent"), // nullable numeric-as-text; see settings module
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  address: text("address"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
