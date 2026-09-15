import { randomUUID } from "node:crypto";
import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { businesses, locations } from "./core";
import { users } from "./auth";

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  // Whole Rupiah.
  amount: integer("amount").notNull(),
  expenseDate: date("expense_date").notNull(),
  payee: text("payee"),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
  attachmentUrl: text("attachment_url"),
  recurring: boolean("recurring").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("expenses_business_expense_date_idx").on(table.businessId, table.expenseDate)]);
