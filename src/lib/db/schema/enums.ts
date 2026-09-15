import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Central place for every Postgres enum used across the schema.
 * Keep these in sync with the string unions in `src/lib/types` if/when
 * those are introduced — Drizzle enums are the source of truth.
 */

export const baseUnitEnum = pgEnum("base_unit", ["gram", "millilitre", "piece"]);

export const orderStatusEnum = pgEnum("order_status", [
  "DRAFT",
  "SUBMITTED",
  "PRINT_PENDING",
  "PRINTED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
]);

export const orderTypeEnum = pgEnum("order_type", ["dine_in", "takeaway", "other"]);

export const movementTypeEnum = pgEnum("movement_type", [
  "PURCHASE_RECEIPT",
  "SALE_CONSUMPTION",
  "WASTE",
  "MANUAL_ADJUSTMENT_IN",
  "MANUAL_ADJUSTMENT_OUT",
  "STOCK_COUNT_CORRECTION",
  "ORDER_CANCELLATION_REVERSAL",
  "REFUND_REVERSAL",
  "OPENING_BALANCE",
]);

export const purchaseStatusEnum = pgEnum("purchase_status", [
  "DRAFT",
  "FINALIZED",
  "REVERSED",
]);

export const stockCountStatusEnum = pgEnum("stock_count_status", [
  "OPEN",
  "SUBMITTED",
  "CANCELLED",
]);

export const printDestinationEnum = pgEnum("print_destination", [
  "CUSTOMER_RECEIPT",
  "KITCHEN_TICKET",
]);

export const printProviderEnum = pgEnum("print_provider", [
  "mock",
  "browser",
  "bridge",
  // Bluetooth printer paired with the staff tablet: the browser sends the
  // ESC/POS bytes, so the server can only queue the job and wait to be told
  // the outcome.
  "device",
]);

export const printStatusEnum = pgEnum("print_status", [
  "QUEUED",
  "PROCESSING",
  "PRINTED",
  "FAILED",
  "CANCELLED",
]);

export const wasteReasonEnum = pgEnum("waste_reason", [
  "expired",
  "spilled",
  "damaged",
  "preparation_waste",
  "incorrect_preparation",
  "other",
]);

/**
 * Fixed role names. Roles are also stored as rows (see `roles` table) so
 * they can be listed/joined normally, but the set is closed — the
 * permission matrix in `src/lib/permissions` is keyed off this union and
 * must be kept in sync.
 */
export const roleNameEnum = pgEnum("role_name", [
  "super_admin",
  "owner",
  "manager",
  "cashier",
  "inventory_staff",
  "viewer",
]);
