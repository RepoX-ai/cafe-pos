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
    name: text("name").notNull(),
    // A user row is an identity, not a staff record — which business (or
    // businesses) it can act in lives in `memberships`. The email is the
    // login and stays globally unique, so one person keeps one account
    // however many cafes they work at.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

// Fixed catalog of roles. Seeded once; not user-editable in the MVP.
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  name: roleNameEnum("name").notNull().unique(),
});

/**
 * A person's access to one business. Replaces the old `users.business_id`
 * column: identity (the `users` row) is global, access is per-business, so
 * one owner or accountant can hold several cafes under a single login.
 *
 * Roles hang off the membership, not the user — the same person can be an
 * Owner at one cafe and a Cashier at another.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    // Revoking access to one business without touching the login itself,
    // and without touching the other businesses the person still works at.
    active: boolean("active").notNull().default(true),
    // Which business to drop the person into at login when they hold more
    // than one; also orders the switcher.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_user_business_idx").on(table.userId, table.businessId),
    index("memberships_business_id_idx").on(table.businessId),
  ],
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.membershipId, table.roleId] })],
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
  // Which business this browser is currently acting in. The cascade is the
  // point: revoke someone's membership and every session pinned to it goes
  // with it, on the next request, exactly like deactivating the account.
  activeMembershipId: uuid("active_membership_id")
    .notNull()
    .references(() => memberships.id, { onDelete: "cascade" }),
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
