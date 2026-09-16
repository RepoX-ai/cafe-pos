import { randomUUID } from "node:crypto";
import {
  boolean,
  integer,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses } from "./core";
import { roleNameEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Global uniqueness: login is by email alone (business is not known
    // up front), so the same email can't be reused across businesses.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email), index("users_business_id_idx").on(table.businessId)],
);

// Fixed catalog of roles. Seeded once; not user-editable in the MVP.
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  name: roleNameEnum("name").notNull().unique(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

/**
 * Server-side session store. We deliberately do not use stateless JWT
 * sessions: storing the session row lets a deactivated user or a revoked
 * session lose access on the very next request, which the PRD requires
 * ("a deactivated user loses access after the next authorization check").
 *
 * Only a SHA-256 hash of the session token is stored — the raw token lives
 * only in the HTTP-only cookie on the client.
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("sessions_user_id_idx").on(table.userId),
  // Expired-session sweep (see deleteExpiredSessions).
  index("sessions_expires_at_idx").on(table.expiresAt),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  beforeSnapshot: jsonb("before_snapshot"),
  afterSnapshot: jsonb("after_snapshot"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_logs_business_created_at_idx").on(table.businessId, table.createdAt, table.id)]);

/**
 * Shared fixed-window rate-limit buckets (login and authenticated actions —
 * the table keeps its original name so running instances stay compatible
 * during a deploy). Hashed keys avoid retaining raw email/IP identifiers.
 */
export const loginAttempts = pgTable("login_attempts", {
  keyHash: text("key_hash").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  // End of the current window; the cleanup job deletes rows past it.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("login_attempts_expires_at_idx").on(table.expiresAt)]);
