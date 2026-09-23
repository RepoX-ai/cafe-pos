import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { menuItems, menuItemVariants, modifierGroups, modifierOptions, users } from "@/lib/db/schema";
import { NotFoundError } from "./errors";

/**
 * The locking protocol, in one place. Every lock here is transaction-scoped
 * (row locks, or `pg_advisory_xact_lock`), so nothing can leak past a
 * commit, rollback or dropped connection. Callers must be inside
 * `db.transaction(...)`.
 *
 * Acquisition order — a transaction may skip levels but never go back up:
 *
 *   1. business creation   (one global advisory lock; business-service)
 *   2. business roster     `lockBusinessRoster`   who holds which role here
 *   3. account identity    `lockAccount`          the shared `users` row
 *   4. catalog rows        `lockVariantForRecipe` / `lockModifierOptionForRecipe`
 *   5. ingredient rows     `lockIngredientsForUpdate` (inventory-service), id order
 *   6. order-number counter (order-service)
 *
 * Rules that follow from it:
 * - Anything that decides "is this account linked to another business?" and
 *   then writes the account (password, name, email, delete) holds the
 *   account lock across both the check and the write. Attaching a
 *   membership takes the same lock, so the check can't go stale.
 * - Anything that can reduce the number of active owners of a business
 *   (demote, deactivate, delete) holds that business's roster lock across
 *   the "someone else is still an owner" check and the write.
 * - Expensive work (bcrypt) happens before the transaction; the protected
 *   section only re-checks and writes.
 */

const ROSTER_LOCK_NAMESPACE = 730_213;

/** Serializes changes to who holds which role in one business (level 2). */
export async function lockBusinessRoster(tx: Database, businessId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ROSTER_LOCK_NAMESPACE}::int, hashtext(${businessId}))`);
}

export type LockedAccount = { id: string; passwordHash: string; active: boolean };

/**
 * Locks the shared account row (level 3). `share` is for readers that must
 * see the account unchanged until they commit (login creating a session);
 * everything that writes the account or its memberships uses `update`.
 */
export async function lockAccount(tx: Database, userId: string, mode: "update" | "share" = "update"): Promise<LockedAccount | null> {
  const [row] = await tx
    .select({ id: users.id, passwordHash: users.passwordHash, active: users.active })
    .from(users)
    .where(eq(users.id, userId))
    .for(mode === "update" ? "update" : "share");
  return row ?? null;
}

/**
 * Locks the variant a recipe hangs off (level 4), which is also the tenant
 * check: the variant must belong to `businessId`. Every recipe write —
 * including the very first, when there is no recipe row yet to lock —
 * serializes here.
 */
export async function lockVariantForRecipe(tx: Database, businessId: string, variantId: string): Promise<void> {
  const [row] = await tx
    .select({ id: menuItemVariants.id })
    .from(menuItemVariants)
    .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
    .where(and(eq(menuItemVariants.id, variantId), eq(menuItems.businessId, businessId)))
    .for("update", { of: menuItemVariants });
  if (!row) throw new NotFoundError("Menu item variant not found");
}

/** Same as `lockVariantForRecipe`, for a modifier option's ingredient lines. */
export async function lockModifierOptionForRecipe(tx: Database, businessId: string, groupId: string, optionId: string): Promise<void> {
  const [row] = await tx
    .select({ id: modifierOptions.id })
    .from(modifierOptions)
    .innerJoin(modifierGroups, eq(modifierOptions.modifierGroupId, modifierGroups.id))
    .where(and(eq(modifierOptions.id, optionId), eq(modifierOptions.modifierGroupId, groupId), eq(modifierGroups.businessId, businessId)))
    .for("update", { of: modifierOptions });
  if (!row) throw new NotFoundError("Modifier option not found");
}
