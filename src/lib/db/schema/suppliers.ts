import { randomUUID } from "node:crypto";
import { boolean, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { businesses } from "./core";

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("suppliers_business_id_idx").on(table.businessId),
  unique("suppliers_business_id_id_key").on(table.businessId, table.id),
]);
