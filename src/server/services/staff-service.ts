import { randomBytes } from "node:crypto";
import { and, count, eq, ne, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  auditLogs,
  expenses,
  inventoryMovements,
  membershipRoles,
  memberships,
  orders,
  printJobs,
  purchases,
  recipes,
  roles,
  stockCounts,
  users,
  wasteRecords,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { invalidateAllUserSessions, invalidateMembershipSessions } from "@/lib/auth/session";
import type { RoleName } from "@/lib/permissions/permissions";
import type { CreateStaffInput, UpdateStaffInput } from "@/lib/validation/staff";
import { recordAuditLog } from "./audit";
import { ConflictError, NotFoundError, ServiceError } from "./errors";
import type { ActorContext } from "./ingredient-service";
import { lockAccount, lockBusinessRoster } from "./locks";

/**
 * A staff row is a *membership*, not an account. `id` stays the user id
 * because that is what every caller and every history table references,
 * but `active`, `roles` and `createdAt` all describe this person at this
 * café only.
 *
 * `linkedElsewhere` is the flag the rest of this module keys off: when the
 * account also works at another business, anything that would change the
 * shared `users` row — their name, their email, their password — belongs
 * to them and not to this café's owner, and is refused.
 */
export interface StaffRow {
  id: string;
  membershipId: string;
  name: string;
  email: string;
  active: boolean;
  roles: RoleName[];
  createdAt: Date;
  linkedElsewhere: boolean;
}

export async function listStaff(db: Database, businessId: string): Promise<StaffRow[]> {
  const staff = await db
    .select({
      id: users.id,
      membershipId: memberships.id,
      name: users.name,
      email: users.email,
      active: memberships.active,
      createdAt: memberships.createdAt,
      roles: sql<string[]>`array(
        select ${roles.name}::text from ${membershipRoles}
        inner join ${roles} on ${roles.id} = ${membershipRoles.roleId}
        where ${membershipRoles.membershipId} = ${memberships.id}
      )`,
      otherMemberships: sql<number>`(
        select count(*)::int from ${memberships} m
        where m.user_id = ${users.id} and m.business_id <> ${businessId}
      )`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.businessId, businessId));

  return staff
    .map((row) => ({
      id: row.id,
      membershipId: row.membershipId,
      name: row.name,
      email: row.email,
      active: row.active,
      roles: row.roles as RoleName[],
      createdAt: row.createdAt,
      linkedElsewhere: row.otherMemberships > 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function generateTempPassword(): string {
  // 12 random bytes -> 16 base64url chars, readable enough to type once
  // and change immediately; never logged, only returned once to the caller.
  return randomBytes(12).toString("base64url");
}

/**
 * Does this account work anywhere other than `businessId`? Only meaningful
 * as an authorization decision while the caller holds `lockAccount` for the
 * user — linking takes the same lock, so the answer can't change before the
 * caller commits.
 */
async function hasOtherMemberships(db: Database, userId: string, businessId: string): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), ne(memberships.businessId, businessId)));
  return Number(row?.value ?? 0) > 0;
}

async function requireMembership(db: Database, userId: string, businessId: string) {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.businessId, businessId)))
    .limit(1);
  if (!membership) throw new NotFoundError("User not found");
  return membership;
}

export type CreateStaffResult = {
  user: typeof users.$inferSelect;
  /** null when an existing CaféOps account was linked — they keep their own password. */
  tempPassword: string | null;
  linkedExistingAccount: boolean;
};

/**
 * Adds someone to this business. If the email already has a CaféOps
 * account — because they work at another café that runs on this install —
 * they are *linked* rather than duplicated: one person, one login, one
 * password they control, with a separate role per café.
 *
 * Linking deliberately does not touch the existing account's name,
 * password or other memberships. The only thing this business gains is a
 * membership row it is entitled to grant.
 *
 * Linking holds the account lock (see locks.ts), so it can never interleave
 * with another café's password reset, identity edit or account deletion
 * that has just decided the account belongs to that café alone.
 *
 * SEC-009: revealing that an email already has an account (link vs create,
 * “already on your staff list”, email clash on update) is intentional for
 * this multi-café linking UX — not a login oracle. See docs/security-ops-notes.md.
 */
export async function createStaff(
  db: Database,
  actor: ActorContext,
  input: CreateStaffInput,
): Promise<CreateStaffResult> {
  const [role] = await db.select().from(roles).where(eq(roles.name, input.role)).limit(1);
  if (!role) throw new ServiceError(`Role "${input.role}" is not set up. Run the seed script to create the role catalog.`);

  async function linkExisting(existingId: string): Promise<CreateStaffResult> {
    const user = await db.transaction(async (tx) => {
      const account = await lockAccount(tx, existingId);
      if (!account) throw new ConflictError("That account was removed a moment ago. Try adding them again.");
      const [existing] = await tx.select().from(users).where(eq(users.id, existingId)).limit(1);

      const [alreadyHere] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, existingId), eq(memberships.businessId, actor.businessId)))
        .limit(1);
      if (alreadyHere) throw new ServiceError("This person is already on your staff list.");

      const [membership] = await tx
        .insert(memberships)
        .values({ userId: existingId, businessId: actor.businessId })
        .returning();
      await tx.insert(membershipRoles).values({ membershipId: membership.id, roleId: role.id });

      await recordAuditLog(tx, {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        action: "user.linked",
        entityType: "user",
        entityId: existingId,
        after: { name: existing.name, email: existing.email, role: input.role },
        metadata: { linkedExistingAccount: true },
      });
      return existing;
    });
    return { user, tempPassword: null, linkedExistingAccount: true };
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) return linkExisting(existing.id);

  // Hashing is the expensive part and happens before any transaction.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    // User, membership, role and audit row land together or not at all —
    // never an account with no business, or a membership with no role.
    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ name: input.name, email: input.email, passwordHash })
        .returning();

      const [membership] = await tx
        .insert(memberships)
        .values({ userId: created.id, businessId: actor.businessId })
        .returning();

      await tx.insert(membershipRoles).values({ membershipId: membership.id, roleId: role.id });

      await recordAuditLog(tx, {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        action: "user.created",
        entityType: "user",
        entityId: created.id,
        after: { name: created.name, email: created.email, role: input.role },
      });

      return created;
    });
    return { user, tempPassword, linkedExistingAccount: false };
  } catch (error) {
    // Someone created this email concurrently (here or at another café):
    // link to the account that won instead of failing.
    if (!isUniqueViolation(error, "users_email_idx")) throw error;
    const [winner] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (!winner) throw error;
    return linkExisting(winner.id);
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = error as { code?: string; constraint?: string; cause?: unknown } | undefined; current; current = current.cause as typeof current) {
    if (current.code === "23505" && current.constraint === constraint) return true;
  }
  return false;
}

/**
 * Suspends or restores someone's access to *this* business by flipping
 * their membership — never `users.active`, which is a global kill switch
 * this screen has no business touching. Somebody stood down at one café
 * keeps working at another.
 *
 * Deactivating can remove the last active Owner, so it runs under the
 * business's roster lock and re-checks that inside it, exactly like
 * demotion and deletion.
 */
export async function setStaffActive(db: Database, actor: ActorContext, userId: string, active: boolean) {
  return db.transaction(async (tx) => {
    await lockBusinessRoster(tx, actor.businessId);
    const membership = await requireMembership(tx, userId, actor.businessId);

    if (!active) {
      if (userId === actor.userId) throw new ServiceError("You can't deactivate your own account.");
      const roleNames = await loadStaffRoles(tx, membership.id);
      if (roleNames.includes("super_admin")) {
        throw new ServiceError("Super Admin accounts are managed outside this screen and can't be deactivated here.");
      }
      if (roleNames.includes("owner") && membership.active) {
        await assertNotLastOwner(tx, actor.businessId, userId, "deactivating them");
      }
    }

    const [row] = await tx
      .update(memberships)
      .set({ active, updatedAt: new Date() })
      .where(eq(memberships.id, membership.id))
      .returning();

    if (!active) {
      // Immediate effect, not just "on next login" — matches the PRD's
      // "a deactivated user loses access after the next authorization
      // check." Only sessions pointed at *this* business are dropped.
      await invalidateMembershipSessions(tx, membership.id);
    }

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: active ? "user.reactivated" : "user.deactivated",
      entityType: "user",
      entityId: userId,
    });

    return row;
  });
}

/**
 * Owner-initiated reset for a staff member who's forgotten their
 * password — there is no self-service "forgot password" flow in the
 * MVP. Invalidates existing sessions too, so a lost/compromised
 * credential can't keep working after the reset.
 *
 * Refused outright for an account that also works at another business:
 * the password is the key to every café that account can reach, so
 * handing one owner the ability to reset it would hand them the others.
 * That check and the write happen under the account lock, which linking
 * also takes — so a café that links the account concurrently either
 * commits first (and this reset is refused) or links an account whose
 * reset has already committed. The temporary password is hashed before
 * the lock is taken; a refused reset just discards it.
 */
export async function resetStaffPassword(
  db: Database,
  actor: ActorContext,
  userId: string,
): Promise<{ tempPassword: string }> {
  await requireMembership(db, userId, actor.businessId);

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await db.transaction(async (tx) => {
    if (!(await lockAccount(tx, userId))) throw new NotFoundError("User not found");
    const membership = await requireMembership(tx, userId, actor.businessId);

    const roleNames = await loadStaffRoles(tx, membership.id);
    if (roleNames.includes("super_admin")) {
      throw new ServiceError("Super Admin accounts are managed outside this screen and their password can't be reset here.");
    }
    if (await hasOtherMemberships(tx, userId, actor.businessId)) {
      throw new ServiceError(
        "This account also works at another business, so its password isn't yours to reset. Ask them to change it themselves.",
      );
    }

    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
    await invalidateAllUserSessions(tx, userId);

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "user.password_reset",
      entityType: "user",
      entityId: userId,
    });
  });

  return { tempPassword };
}

async function loadStaffRoles(db: Database, membershipId: string): Promise<RoleName[]> {
  const rows = await db
    .select({ name: roles.name })
    .from(membershipRoles)
    .innerJoin(roles, eq(membershipRoles.roleId, roles.id))
    .where(eq(membershipRoles.membershipId, membershipId));
  return rows.map((r) => r.name as RoleName);
}

/**
 * Guards against locking the business out of its own admin screens: an
 * Owner may only be demoted, deactivated or deleted while some *other*
 * active Owner remains. Deactivated owners don't count — they can't log in
 * to undo it. Counted over memberships, so an Owner here who is a Cashier
 * elsewhere is still this café's only Owner.
 *
 * Callers must hold `lockBusinessRoster` for the business: otherwise two
 * owners demoting each other at the same moment would each see the other
 * as the one who remains.
 */
async function assertNotLastOwner(db: Database, businessId: string, userId: string, action: string) {
  const [remaining] = await db
    .select({ value: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .innerJoin(roles, eq(membershipRoles.roleId, roles.id))
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.active, true),
        eq(users.active, true),
        eq(roles.name, "owner"),
        ne(memberships.userId, userId),
      ),
    );
  if (Number(remaining?.value ?? 0) === 0) {
    throw new ServiceError(`This is the only active Owner — ${action} would leave nobody able to manage staff or settings.`);
  }
}

/**
 * Edits a staff member's role, and — when the account belongs to this
 * business alone — their name and email.
 *
 * Runs under the roster lock (a role change can demote the last Owner) and
 * the account lock (the "belongs to this business alone" check must still
 * hold when the shared account is written), in that order.
 *
 * Sessions are deliberately left alone: they're keyed to the user id, not
 * the email, and roles are re-read from the database on every request, so
 * both changes take effect on the staff member's very next click without
 * forcing them to log back in mid-shift.
 */
export async function updateStaff(
  db: Database,
  actor: ActorContext,
  userId: string,
  input: UpdateStaffInput,
) {
  return db.transaction(async (tx) => {
    await lockBusinessRoster(tx, actor.businessId);
    if (!(await lockAccount(tx, userId))) throw new NotFoundError("User not found");
    const membership = await requireMembership(tx, userId, actor.businessId);

    const [existing] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw new NotFoundError("User not found");

    const currentRoles = await loadStaffRoles(tx, membership.id);
    if (currentRoles.includes("super_admin")) {
      throw new ServiceError("Super Admin accounts are managed outside this screen and can't be edited here.");
    }

    // The role is per-café and always yours to set. Name and email live on
    // the shared account, so they are only editable while this café is the
    // only one the account belongs to.
    const linkedElsewhere = await hasOtherMemberships(tx, userId, actor.businessId);
    const identityChanged = input.name !== existing.name || input.email !== existing.email;
    if (linkedElsewhere && identityChanged) {
      throw new ServiceError(
        "This account also works at another business, so its name and email can only be changed by them. You can still change their role here.",
      );
    }

    if (input.email !== existing.email) {
      const [clash] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
      if (clash && clash.id !== userId) throw new ServiceError("A user with this email already exists.");
    }

    const roleChanged = currentRoles.length !== 1 || currentRoles[0] !== input.role;
    if (roleChanged && currentRoles.includes("owner") && membership.active) {
      await assertNotLastOwner(tx, actor.businessId, userId, "changing their role");
    }

    const [roleRow] = await tx.select().from(roles).where(eq(roles.name, input.role)).limit(1);
    if (!roleRow) throw new ServiceError(`Role "${input.role}" is not set up.`);

    let updated = existing;
    if (identityChanged) {
      try {
        [updated] = await tx
          .update(users)
          .set({ name: input.name, email: input.email, updatedAt: new Date() })
          .where(eq(users.id, userId))
          .returning();
      } catch (error) {
        if (isUniqueViolation(error, "users_email_idx")) throw new ServiceError("A user with this email already exists.");
        throw error;
      }
    }

    if (roleChanged) {
      await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membership.id));
      await tx.insert(membershipRoles).values({ membershipId: membership.id, roleId: roleRow.id });
    }

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "user.updated",
      entityType: "user",
      entityId: userId,
      before: { name: existing.name, email: existing.email, roles: currentRoles },
      after: { name: updated.name, email: updated.email, role: input.role },
    });

    return updated;
  });
}

export interface StaffAttributionEntry {
  label: string;
  count: number;
}

/**
 * What removing them would blank out *in this business*. Every history
 * table points at `users.id` with ON DELETE SET NULL, so deleting the
 * account doesn't remove a single record — it removes the *name* attached
 * to them, and past reports lose who rang the sale or counted the stock.
 * The confirm dialog shows these counts so the owner deletes with their
 * eyes open.
 *
 * Every count is scoped to the actor's business. Without that, an owner
 * would be shown how much work the same person has done at a café they
 * have no relationship with.
 */
export async function countStaffAttribution(
  db: Database,
  actor: ActorContext,
  userId: string,
): Promise<StaffAttributionEntry[]> {
  await requireMembership(db, userId, actor.businessId);
  const business = actor.businessId;

  async function tally(label: string, query: PromiseLike<{ value: number }[]>): Promise<StaffAttributionEntry> {
    const rows = await query;
    return { label, count: Number(rows[0]?.value ?? 0) };
  }

  const entries = await Promise.all([
    tally(
      "Orders",
      db
        .select({ value: count() })
        .from(orders)
        .where(
          and(
            eq(orders.businessId, business),
            or(eq(orders.createdBy, userId), eq(orders.cancelledBy, userId), eq(orders.refundedBy, userId)),
          ),
        ),
    ),
    tally(
      "Purchases",
      db
        .select({ value: count() })
        .from(purchases)
        .where(and(eq(purchases.businessId, business), eq(purchases.createdBy, userId))),
    ),
    tally(
      "Stock movements",
      db
        .select({ value: count() })
        .from(inventoryMovements)
        .where(and(eq(inventoryMovements.businessId, business), eq(inventoryMovements.createdBy, userId))),
    ),
    tally(
      "Stock counts",
      db
        .select({ value: count() })
        .from(stockCounts)
        .where(and(eq(stockCounts.businessId, business), eq(stockCounts.countedBy, userId))),
    ),
    tally(
      "Waste records",
      db
        .select({ value: count() })
        .from(wasteRecords)
        .where(and(eq(wasteRecords.businessId, business), eq(wasteRecords.createdBy, userId))),
    ),
    tally(
      "Expenses",
      db
        .select({ value: count() })
        .from(expenses)
        .where(and(eq(expenses.businessId, business), eq(expenses.createdBy, userId))),
    ),
    tally(
      "Recipes",
      db
        .select({ value: count() })
        .from(recipes)
        .where(and(eq(recipes.businessId, business), eq(recipes.createdBy, userId))),
    ),
    tally(
      "Print jobs",
      db
        .select({ value: count() })
        .from(printJobs)
        .where(and(eq(printJobs.businessId, business), eq(printJobs.requestedBy, userId))),
    ),
    tally(
      "Audit log entries",
      db
        .select({ value: count() })
        .from(auditLogs)
        .where(and(eq(auditLogs.businessId, business), eq(auditLogs.actorUserId, userId))),
    ),
  ]);

  return entries.filter((entry) => entry.count > 0);
}

export interface DeleteStaffResult {
  user: typeof users.$inferSelect;
  /** false when the account survived because it still works elsewhere. */
  accountDeleted: boolean;
}

/**
 * Removes someone from this business.
 *
 * What that means depends on where else they work. If this was their only
 * business the whole account goes, exactly as before: `membership_roles`
 * and `sessions` follow via ON DELETE CASCADE, every history reference is
 * nulled by the schema, and the records survive without a name on them —
 * see `countStaffAttribution`, which the UI shows before this is called.
 * If they still work at another café the account is theirs, not this
 * café's, so only the membership is removed and their name stays on this
 * business's history.
 *
 * Holds the roster lock (they may be the last Owner) and then the account
 * lock, so a café linking this account at the same moment either commits
 * first — and only this café's membership is removed — or waits and finds
 * the account gone. The account delete itself also refuses to run while
 * any other membership exists, as a last line of defence against a cascade
 * into another business.
 *
 * The audit row is written inside the same transaction and before the
 * delete, and `audit_logs.entity_id` is a plain text column with no
 * foreign key, so the log keeps a permanent record of which name and
 * email that id belonged to.
 */
export async function deleteStaff(db: Database, actor: ActorContext, userId: string): Promise<DeleteStaffResult> {
  return db.transaction(async (tx) => {
    if (userId === actor.userId) {
      throw new ServiceError("You can't delete your own account.");
    }

    await lockBusinessRoster(tx, actor.businessId);
    if (!(await lockAccount(tx, userId))) throw new NotFoundError("User not found");
    const membership = await requireMembership(tx, userId, actor.businessId);

    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundError("User not found");

    const roleNames = await loadStaffRoles(tx, membership.id);
    if (roleNames.includes("super_admin")) {
      throw new ServiceError("Super Admin accounts are managed outside this screen and can't be deleted here.");
    }
    if (roleNames.includes("owner") && membership.active) {
      await assertNotLastOwner(tx, actor.businessId, userId, "deleting them");
    }

    const linkedElsewhere = await hasOtherMemberships(tx, userId, actor.businessId);

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "user.deleted",
      entityType: "user",
      entityId: userId,
      before: { name: user.name, email: user.email, roles: roleNames, active: membership.active },
      metadata: { accountDeleted: !linkedElsewhere },
    });

    if (linkedElsewhere) {
      await invalidateMembershipSessions(tx, membership.id);
      await tx.delete(memberships).where(eq(memberships.id, membership.id));
      return { user, accountDeleted: false };
    }

    const deleted = await tx
      .delete(users)
      .where(
        and(
          eq(users.id, userId),
          sql`not exists (select 1 from ${memberships} m where m.user_id = ${userId} and m.business_id <> ${actor.businessId})`,
        ),
      )
      .returning({ id: users.id });
    if (deleted.length === 0) throw new ConflictError("This account was just added to another business. Reload and try again.");
    return { user, accountDeleted: true };
  });
}
