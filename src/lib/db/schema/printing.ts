import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { businesses } from "./core";
import { orders } from "./orders";
import { printDestinationEnum, printProviderEnum, printStatusEnum } from "./enums";
import { users } from "./auth";

export const printJobs = pgTable("print_jobs", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  // Denormalised from the order, so a print job can be scoped without
  // joining through `orders` on every read.
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
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
  // Client-generated key for one deliberate reprint request, so a retried
  // request returns the same job instead of queueing another receipt.
  requestKey: text("request_key"),
  // Set while a worker holds the job in PROCESSING. Completion only lands
  // if the token still matches, so a worker whose lease expired can't
  // overwrite a newer attempt.
  claimToken: uuid("claim_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  printedAt: timestamp("printed_at", { withTimezone: true }),
}, (table) => [
  index("print_jobs_order_created_at_idx").on(table.orderId, table.createdAt),
  index("print_jobs_business_created_at_idx").on(table.businessId, table.createdAt),
  uniqueIndex("print_jobs_order_request_key_idx").on(table.orderId, table.requestKey),
  // Failed and possibly-abandoned jobs are the only ones the dashboard and recovery scan look for.
  index("print_jobs_attention_idx")
    .on(table.createdAt)
    .where(sql`${table.status} in ('FAILED', 'PROCESSING')`),
]);
