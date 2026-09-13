import { randomBytes } from "node:crypto";
import { and, count, eq, ne, or } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  auditLogs,
  expenses,
  inventoryMovements,
  orders,
  printJobs,
  purchases,
  recipes,
  roles,
  stockCounts,
  userRoles,
  users,
  wasteRecords,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { invalidateAllUserSessions } from "@/lib/auth/session";
import type { RoleName } from "@/lib/permissions/permissions";
import type { CreateStaffInput, UpdateStaffInput } from "@/lib/validation/staff";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roles: RoleName[];
  createdAt: Date;
}

export async function listStaff(db: Database, businessId: string): Promise<StaffRow[]> {
  const staff = await db.select().from(users).where(eq(users.businessId, businessId));
  const roleRows = await db
    .select({ userId: userRoles.userId, roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(eq(users.businessId, businessId));

  const rolesByUser = new Map<string, RoleName[]>();
  for (const row of roleRows) {
    const list = rolesByUser.get(row.userId) ?? [];
    list.push(row.roleName as RoleName);
    rolesByUser.set(row.userId, list);
  }

  return staff
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      active: u.active,
      roles: rolesByUser.get(u.id) ?? [],
      createdAt: u.createdAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function generateTempPassword(): string {
  // 12 random bytes -> 16 base64url chars, readable enough to type once
  // and change immediately; never logged, only returned once to the caller.
  return randomBytes(12).toString("base64url");
}

export async function createStaff(
  db: Database,
  actor: ActorContext,
  input: CreateStaffInput,
): Promise<{ user: typeof users.$inferSelect; tempPassword: string }> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) {
    throw new Error("A user with this email already exists.");
  }

  const [role] = await db.select().from(roles).where(eq(roles.name, input.role)).limit(1);
  if (!role) throw new Error(`Role "${input.role}" is not set up. Run the seed script to create the role catalog.`);

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const [user] = await db
    .insert(users)
    .values({ businessId: actor.businessId, name: input.name, email: input.email, passwordHash })
    .returning();

  await db.insert(userRoles).values({ userId: user.id, roleId: role.id });

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    after: { name: user.name, email: user.email, role: input.role },
  });

  return { user, tempPassword };
}

export async function setStaffActive(db: Database, actor: ActorContext, userId: string, active: boolean) {
  const [row] = await db
    .update(users)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.businessId, actor.businessId)))
    .returning();
  if (!row) throw new Error("User not found");

  if (!active) {
    // Immediate effect, not just "on next login" — matches the PRD's
    // "a deactivated user loses access after the next authorization check."
    await invalidateAllUserSessions(db, userId);
  }

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: active ? "user.reactivated" : "user.deactivated",
    entityType: "user",
    entityId: userId,
  });

  return row;
}

/**
 * Owner-initiated reset for a staff member who's forgotten their
 * password — there is no self-service "forgot password" flow in the
 * MVP. Invalidates existing sessions too, so a lost/compromised
 * credential can't keep working after the reset.
 */
export async function resetStaffPassword(
  db: Database,
  actor: ActorContext,
  userId: string,
): Promise<{ tempPassword: string }> {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.businessId, actor.businessId))).limit(1);
  if (!user) throw new Error("User not found");

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  await invalidateAllUserSessions(db, userId);

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "user.password_reset",
    entityType: "user",
    entityId: userId,
  });

  return { tempPassword };
}

async function loadStaffRoles(db: Database, userId: string): Promise<RoleName[]> {
  const rows = await db
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.name as RoleName);
}

/**
 * Guards against locking the business out of its own admin screens: an
 * Owner may only be demoted or deleted while some *other* active Owner
 * remains. Deactivated owners don't count — they can't log in to undo it.
 */
async function assertNotLastOwner(db: Database, businessId: string, userId: string, action: string) {
  const [remaining] = await db
    .select({ value: count() })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(
      and(
        eq(users.businessId, businessId),
        eq(users.active, true),
        eq(roles.name, "owner"),
        ne(users.id, userId),
      ),
    );
  if (Number(remaining?.value ?? 0) === 0) {
    throw new Error(`This is the only active Owner — ${action} would leave nobody able to manage staff or settings.`);
  }
}

/**
 * Edits a staff member's name, email, and role in one transaction.
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
    const [existing] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.businessId, actor.businessId)))
      .limit(1);
    if (!existing) throw new Error("User not found");

    const currentRoles = await loadStaffRoles(tx, userId);
    if (currentRoles.includes("super_admin")) {
      throw new Error("Super Admin accounts are managed outside this screen and can't be edited here.");
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

    const [updated] = await tx
      .update(users)
      .set({ name: input.name, email: input.email, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();

    if (roleChanged) {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      await tx.insert(userRoles).values({ userId, roleId: roleRow.id });
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
 * What a hard delete would blank out. Every history table points at
 * `users.id` with ON DELETE SET NULL, so deleting the account doesn't
 * remove a single record — it removes the *name* attached to them, and
 * past reports lose who rang the sale or counted the stock. The confirm
 * dialog shows these counts so the owner deletes with their eyes open.
 */
export async function countStaffAttribution(
  db: Database,
  actor: ActorContext,
  userId: string,
): Promise<StaffAttributionEntry[]> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.businessId, actor.businessId)))
    .limit(1);
  if (!user) throw new Error("User not found");

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
        .where(or(eq(orders.createdBy, userId), eq(orders.cancelledBy, userId), eq(orders.refundedBy, userId))),
    ),
    tally("Purchases", db.select({ value: count() }).from(purchases).where(eq(purchases.createdBy, userId))),
    tally(
      "Stock movements",
      db.select({ value: count() }).from(inventoryMovements).where(eq(inventoryMovements.createdBy, userId)),
    ),
    tally("Stock counts", db.select({ value: count() }).from(stockCounts).where(eq(stockCounts.countedBy, userId))),
    tally("Waste records", db.select({ value: count() }).from(wasteRecords).where(eq(wasteRecords.createdBy, userId))),
    tally("Expenses", db.select({ value: count() }).from(expenses).where(eq(expenses.createdBy, userId))),
    tally("Recipes", db.select({ value: count() }).from(recipes).where(eq(recipes.createdBy, userId))),
    tally("Print jobs", db.select({ value: count() }).from(printJobs).where(eq(printJobs.requestedBy, userId))),
    tally("Audit log entries", db.select({ value: count() }).from(auditLogs).where(eq(auditLogs.actorUserId, userId))),
  ]);

  return entries.filter((entry) => entry.count > 0);
}

/**
 * Permanently removes the account. Their `user_roles` and `sessions` rows
 * go with it via ON DELETE CASCADE; every history reference is nulled by
 * the schema, so the records survive without a name on them — see
 * `countStaffAttribution`, which the UI shows before this is called.
 *
 * The audit row is written inside the same transaction and before the
 * delete, and `audit_logs.entity_id` is a plain text column with no
 * foreign key, so the log keeps a permanent record of which name and
 * email that id belonged to.
 */
export async function deleteStaff(db: Database, actor: ActorContext, userId: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.businessId, actor.businessId)))
      .limit(1);
    if (!user) throw new Error("User not found");

    if (userId === actor.userId) {
      throw new Error("You can't delete your own account.");
    }

    const roleNames = await loadStaffRoles(tx, userId);
    if (roleNames.includes("super_admin")) {
      throw new Error("Super Admin accounts are managed outside this screen and can't be deleted here.");
    }
    if (roleNames.includes("owner")) {
      await assertNotLastOwner(tx, actor.businessId, userId, "deleting them");
    }

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "user.deleted",
      entityType: "user",
      entityId: userId,
      before: { name: user.name, email: user.email, roles: roleNames, active: user.active },
    });

    await tx.delete(users).where(and(eq(users.id, userId), eq(users.businessId, actor.businessId)));

    return user;
  });
}
