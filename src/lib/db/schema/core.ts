import { randomUUID } from "node:crypto";
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  logoUrl: text("logo_url"),
  /**
   * The one accent colour this business is themed with, as `#rrggbb`. Null
   * falls back to the app default. The secondary/contrast tokens are
   * derived from it at render time (`src/lib/branding`) rather than stored,
   * so they can never drift out of step with it.
   */
  brandColor: text("brand_color"),
  /**
   * The logo again, as a 1-bit ESC/POS raster, so thermal receipts can
   * print it without any image decoder on the server or the tablet. Packed
   * 8 pixels per byte, MSB first, base64-encoded; `logoRasterWidth` is in
   * dots and is a multiple of 8. Written once when the logo is uploaded —
   * see `src/lib/branding/raster.ts`.
   */
  logoRasterBase64: text("logo_raster_base64"),
  logoRasterWidth: integer("logo_raster_width"),
  logoRasterHeight: integer("logo_raster_height"),
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
