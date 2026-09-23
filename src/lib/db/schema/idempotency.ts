import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { businesses } from "./core";

/**
 * One row per client-supplied idempotency key for a back-office write
 * (purchase receipt, waste, stock count, manual adjustment, expense). The
 * key is scoped to the business *and* the operation, so the same string
 * sent to two different forms, or by two cafés, never collides.
 *
 * The row is inserted inside the same transaction as the write it guards:
 * a lost-response retry either finds the committed row and gets the
 * original result back, or — if the first attempt rolled back — finds
 * nothing and runs normally. `requestHash` is a hash of the validated
 * payload, so reusing a key for a *different* payload is refused instead of
 * silently returning an unrelated result. Orders keep their own
 * `orders.idempotency_key` column (older, and part of the order row).
 */
export const requestIdempotency = pgTable(
  "request_idempotency",
  {
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    // The row the original request created, returned to a retry.
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.businessId, table.operation, table.key] }),
    // Retention sweep (keys are only needed for the retry window).
    index("request_idempotency_created_at_idx").on(table.createdAt),
  ],
);
