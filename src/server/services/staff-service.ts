import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { roles, userRoles, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { invalidateAllUserSessions } from "@/lib/auth/session";
import type { RoleName } from "@/lib/permissions/permissions";
import type { CreateStaffInput } from "@/lib/validation/staff";
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

export async function changeStaffRole(db: Database, actor: ActorContext, userId: string, role: RoleName) {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.businessId, actor.businessId))).limit(1);
  if (!user) throw new Error("User not found");

  const [roleRow] = await db.select().from(roles).where(eq(roles.name, role)).limit(1);
  if (!roleRow) throw new Error(`Role "${role}" is not set up.`);

  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values({ userId, roleId: roleRow.id });
  });

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "user.role_changed",
    entityType: "user",
    entityId: userId,
    metadata: { role },
  });
}
