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
import type { ActorContext } from "./ingredient-service";

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

/** Does this account work anywhere other than `businessId`? */
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
  if (!membership) throw new Error("User not found");
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
 */
export async function createStaff(
  db: Database,
  actor: ActorContext,
  input: CreateStaffInput,
): Promise<CreateStaffResult> {
  const [role] = await db.select().from(roles).where(eq(roles.name, input.role)).limit(1);
  if (!role) throw new Error(`Role "${input.role}" is not set up. Run the seed script to create the role catalog.`);

  const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

  if (existing) {
    const [alreadyHere] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, existing.id), eq(memberships.businessId, actor.businessId)))
      .limit(1);
    if (alreadyHere) {
      throw new Error("This person is already on your staff list.");
    }

    const user = await db.transaction(async (tx) => {
      const [membership] = await tx
        .insert(memberships)
        .values({ userId: existing.id, businessId: actor.businessId })
        .returning();
      await tx.insert(membershipRoles).values({ membershipId: membership.id, roleId: role.id });

      await recordAuditLog(tx, {
        businessId: actor.businessId,
        actorUserId: actor.userId,
        action: "user.linked",
        entityType: "user",
        entityId: existing.id,
        after: { name: existing.name, email: existing.email, role: input.role },
        metadata: { linkedExistingAccount: true },
      });

      return existing;
    });

    return { user, tempPassword: null, linkedExistingAccount: true };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

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
}

/**
 * Suspends or restores someone's access to *this* business by flipping
 * their membership — never `users.active`, which is a global kill switch
 * this screen has no business touching. Somebody stood down at one café
 * keeps working at another.
 */
export async function setStaffActive(db: Database, actor: ActorContext, userId: string, active: boolean) {
  return db.transaction(async (tx) => {
    const membership = await requireMembership(tx, userId, actor.businessId);

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
 */
export async function resetStaffPassword(
  db: Database,
  actor: ActorContext,
  userId: string,
): Promise<{ tempPassword: string }> {
  await requireMembership(db, userId, actor.businessId);

  if (await hasOtherMemberships(db, userId, actor.businessId)) {
    throw new Error(
      "This account also works at another business, so its password isn't yours to reset. Ask them to change it themselves.",
    );
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await db.transaction(async (tx) => {
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
 * Owner may only be demoted or deleted while some *other* active Owner
 * remains. Deactivated owners don't count — they can't log in to undo it.
 * Counted over memberships, so an Owner here who is a Cashier elsewhere
 * is still this café's only Owner.
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
    throw new Error(`This is the only active Owner — ${action} would leave nobody able to manage staff or settings.`);
  }
}

/**
 * Edits a staff member's role, and — when the account belongs to this
 * business alone — their name and email.
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
    const membership = await requireMembership(tx, userId, actor.businessId);

    const [existing] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) throw new Error("User not found");

    const currentRoles = await loadStaffRoles(tx, membership.id);
    if (currentRoles.includes("super_admin")) {
      throw new Error("Super Admin accounts are managed outside this screen and can't be edited here.");
    }

    // The role is per-café and always yours to set. Name and email live on
    // the shared account, so they are only editable while this café is the
    // only one the account belongs to.
    const linkedElsewhere = await hasOtherMemberships(tx, userId, actor.businessId);
    const identityChanged = input.name !== existing.name || input.email !== existing.email;
    if (linkedElsewhere && identityChanged) {
      throw new Error(
        "This account also works at another business, so its name and email can only be changed by them. You can still change their role here.",
      );
    }

    if (input.email !== existing.email) {
      const [clash] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
      if (clash && clash.id !== userId) throw new Error("A user with this email already exists.");
    }

    const roleChanged = currentRoles.length !== 1 || currentRoles[0] !== input.role;
    if (roleChanged && currentRoles.includes("owner")) {
      await assertNotLastOwner(tx, actor.businessId, userId, "changing their role");
    }

    const [roleRow] = await tx.select().from(roles).where(eq(roles.name, input.role)).limit(1);
    if (!roleRow) throw new Error(`Role "${input.role}" is not set up.`);

    const updated = identityChanged
      ? (
          await tx
            .update(users)
            .set({ name: input.name, email: input.email, updatedAt: new Date() })
            .where(eq(users.id, userId))
            .returning()
        )[0]
      : existing;

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
 * The audit row is written inside the same transaction and before the
 * delete, and `audit_logs.entity_id` is a plain text column with no
 * foreign key, so the log keeps a permanent record of which name and
 * email that id belonged to.
 */
export async function deleteStaff(db: Database, actor: ActorContext, userId: string): Promise<DeleteStaffResult> {
  return db.transaction(async (tx) => {
    const membership = await requireMembership(tx, userId, actor.businessId);

    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new Error("User not found");

    if (userId === actor.userId) {
      throw new Error("You can't delete your own account.");
    }

    const roleNames = await loadStaffRoles(tx, membership.id);
    if (roleNames.includes("super_admin")) {
      throw new Error("Super Admin accounts are managed outside this screen and can't be deleted here.");
    }
    if (roleNames.includes("owner")) {
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

    await tx.delete(users).where(eq(users.id, userId));
    return { user, accountDeleted: true };
  });
}
