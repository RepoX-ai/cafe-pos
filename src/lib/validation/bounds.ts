import { z } from "zod";
import { isCalendarDate } from "@/lib/dates/dates";

/**
 * Column-derived ceilings for request validation. Anything over these would
 * otherwise reach PostgreSQL and fail there (numeric/integer overflow, bad
 * date) as an unhandled error instead of a field message.
 */
export const BOUNDS = {
  /** PostgreSQL `integer`: whole-Rupiah money columns, display orders. */
  maxInt: 2_147_483_647,
  /** numeric(16,4): base-unit quantities (12 integer digits). */
  maxQuantity: 999_999_999_999,
  /** numeric(16,6): conversion factors and per-unit rates (10 integer digits). */
  maxRate: 9_999_999_999,
  displayOrder: 1_000_000,
  purchaseLines: 100,
  stockCountLines: 500,
  recipeLines: 50,
  modifierGroupsPerItem: 50,
  maxSelections: 50,
} as const;

/** A Y-M-D date within the app's supported years (see isCalendarDate). */
export const calendarDateSchema = z.string().refine(isCalendarDate, "Enter a valid date");

export const displayOrderSchema = z.coerce.number().int().min(-BOUNDS.displayOrder).max(BOUNDS.displayOrder).default(0);

/** Optional client-generated key that makes a write safe to retry (see request_idempotency). */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{16,100}$/, "Invalid request key")
  .optional()
  .or(z.literal("").transform(() => undefined));
