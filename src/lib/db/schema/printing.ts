import { randomUUID } from "node:crypto";
import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { orders } from "./orders";
import { printDestinationEnum, printProviderEnum, printStatusEnum } from "./enums";
import { users } from "./auth";

export const printJobs = pgTable("print_jobs", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  destination: printDestinationEnum("destination").notNull(),
  provider: printProviderEnum("provider").notNull(),
  status: printStatusEnum("status").notNull().default("QUEUED"),
  attemptCount: integer("attempt_count").notNull().default(0),
  // Full PrintJobPayload snapshot — so later menu edits never change what
  // a reprint would show.
  payloadSnapshot: jsonb("payload_snapshot").notNull(),
  lastError: text("last_error"),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  printedAt: timestamp("printed_at", { withTimezone: true }),
});
