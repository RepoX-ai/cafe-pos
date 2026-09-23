import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTestDb, seedTestFixture, type TestDb } from "./helpers";
import { LockHolder, track } from "./concurrency-helpers";
import { createStaff, deleteStaff, resetStaffPassword, setStaffActive, updateStaff } from "@/server/services/staff-service";
import { changeOwnPassword } from "@/server/services/account-service";
import { login } from "@/server/services/auth-service";
import { createSession } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { ROLE_NAMES } from "@/lib/validation/staff";
import type { RoleName } from "@/lib/permissions/permissions";

// Separate pools so racing calls really use separate connections.
const dbA = getTestDb();
const dbB = getTestDb();
const holderDb = getTestDb();

afterAll(async () => {
  await Promise.all([dbA?.$client.end(), dbB?.$client.end(), holderDb?.$client.end()]);
});

const ROSTER_LOCK_NAMESPACE = 730_213;

async function ensureRoleCatalog(db: TestDb) {
  await db.insert(schema.roles).values([...ROLE_NAMES, "super_admin" as const].map((name) => ({ name }))).onConflictDoNothing();
}

async function setRole(db: TestDb, userId: string, businessId: string, name: RoleName) {
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.businessId, businessId)))
    .limit(1);
  await db.delete(schema.membershipRoles).where(eq(schema.membershipRoles.membershipId, membership.id));
  await db.insert(schema.membershipRoles).values({ membershipId: membership.id, roleId: role.id });
  return membership;
}

/** Café A with an owner and a cashier who works only at A; café B with its own owner. */
async function scenario() {
  await ensureRoleCatalog(dbA!);
  const a = await seedTestFixture(dbA!);
  const b = await seedTestFixture(dbA!);
  await setRole(dbA!, a.user.id, a.business.id, "owner");
  await setRole(dbA!, b.user.id, b.business.id, "owner");
  const actorA = { businessId: a.business.id, userId: a.user.id };
  const actorB = { businessId: b.business.id, userId: b.user.id };
  const email = `cashier-${randomUUID().slice(0, 8)}@test.local`;
  const { user: staff } = await createStaff(dbA!, actorA, { name: "Sari", email, role: "cashier" });
  return { a, b, actorA, actorB, email, staff };
}

async function holdAccountLock(userId: string) {
  const holder = await LockHolder.begin(holderDb!.$client);
  await holder.query("select id from users where id = $1 for update", [userId]);
  return holder;
}

async function passwordHashOf(userId: string) {
  const [row] = await dbA!.select({ h: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, userId));
  return row?.h;
}

describe.skipIf(!dbA)("shared-account concurrency (PostgreSQL)", () => {
  it("refuses a password reset once another café links the account while the reset was in flight", async () => {
    const s = await scenario();
    const hashBefore = await passwordHashOf(s.staff.id);

    // Both the reset's pre-check (outside the lock) and bcrypt pass while
    // the account is still A-only; the link and the reset then queue up.
    const holder = await holdAccountLock(s.staff.id);
    const link = track(createStaff(dbB!, s.actorB, { name: "Sari", email: s.email, role: "manager" }));
    await holder.waitForBlocked(1);
    const reset = track(resetStaffPassword(dbA!, s.actorA, s.staff.id));
    await holder.waitForBlocked(2);
    expect(link.state.settled || reset.state.settled).toBe(false);
    await holder.commit();

    await expect(link.promise).resolves.toMatchObject({ linkedExistingAccount: true });
    await expect(reset.promise).rejects.toThrow("also works at another business");
    expect(await passwordHashOf(s.staff.id)).toBe(hashBefore);
  });

  it("links an account whose reset committed first, and never lets the reset land afterwards", async () => {
    const s = await scenario();
    const holder = await holdAccountLock(s.staff.id);
    const reset = track(resetStaffPassword(dbA!, s.actorA, s.staff.id));
    await holder.waitForBlocked(1);
    const link = track(createStaff(dbB!, s.actorB, { name: "Sari", email: s.email, role: "manager" }));
    await holder.waitForBlocked(2);
    await holder.commit();

    const { tempPassword } = await reset.promise;
    await link.promise;
    // The reset is linearized before the link: once linked, A can no longer reset.
    expect(await verifyPassword(tempPassword, (await passwordHashOf(s.staff.id))!)).toBe(true);
    await expect(resetStaffPassword(dbA!, s.actorA, s.staff.id)).rejects.toThrow("also works at another business");
  });

  it("never cascades an account deletion into a café that linked it concurrently", async () => {
    const s = await scenario();
    const holder = await holdAccountLock(s.staff.id);
    const link = track(createStaff(dbB!, s.actorB, { name: "Sari", email: s.email, role: "manager" }));
    await holder.waitForBlocked(1);
    const del = track(deleteStaff(dbA!, s.actorA, s.staff.id));
    await holder.waitForBlocked(2);
    await holder.commit();

    await link.promise;
    await expect(del.promise).resolves.toMatchObject({ accountDeleted: false });
    const remaining = await dbA!.select().from(schema.memberships).where(eq(schema.memberships.userId, s.staff.id));
    expect(remaining.map((m) => m.businessId)).toEqual([s.b.business.id]);
    expect(await passwordHashOf(s.staff.id)).toBeDefined();
  });

  it("fails a link cleanly when the account is deleted first", async () => {
    const s = await scenario();
    const holder = await holdAccountLock(s.staff.id);
    const del = track(deleteStaff(dbA!, s.actorA, s.staff.id));
    await holder.waitForBlocked(1);
    const link = track(createStaff(dbB!, s.actorB, { name: "Sari", email: s.email, role: "manager" }));
    await holder.waitForBlocked(2);
    await holder.commit();

    await expect(del.promise).resolves.toMatchObject({ accountDeleted: true });
    await expect(link.promise).rejects.toThrow("removed a moment ago");
    expect(await dbA!.$count(schema.memberships, eq(schema.memberships.userId, s.staff.id))).toBe(0);
  });

  it("refuses an identity edit when the account was linked while the edit waited", async () => {
    const s = await scenario();
    const holder = await holdAccountLock(s.staff.id);
    const link = track(createStaff(dbB!, s.actorB, { name: "Sari", email: s.email, role: "manager" }));
    await holder.waitForBlocked(1);
    const edit = track(updateStaff(dbA!, s.actorA, s.staff.id, { name: "Renamed", email: `x-${s.email}`, role: "cashier" }));
    await holder.waitForBlocked(2);
    await holder.commit();

    await link.promise;
    await expect(edit.promise).rejects.toThrow("can only be changed by them");
    const [user] = await dbA!.select().from(schema.users).where(eq(schema.users.id, s.staff.id));
    expect(user).toMatchObject({ name: "Sari", email: s.email });
  });

  it("drops a session minted from the old password when a reset lands mid-login", async () => {
    const s = await scenario();
    const known = "known-old-password-123";
    await dbA!.update(schema.users).set({ passwordHash: await hashPassword(known) }).where(eq(schema.users.id, s.staff.id));

    const holder = await holdAccountLock(s.staff.id);
    const loggingIn = track(login(dbB!, s.email, known));
    await holder.waitForBlocked(1); // bcrypt has already accepted the old password
    const reset = track(resetStaffPassword(dbA!, s.actorA, s.staff.id));
    await holder.waitForBlocked(2);
    await holder.commit();

    const result = await loggingIn.promise;
    await reset.promise;
    // Whichever order the two committed in, no session survives the reset.
    expect(result.ok === false || result.ok === true).toBe(true);
    expect(await dbA!.$count(schema.sessions, eq(schema.sessions.userId, s.staff.id))).toBe(0);
  });

  it("rejects a login whose verified hash was replaced before the session was written", async () => {
    const s = await scenario();
    const known = "known-old-password-456";
    await dbA!.update(schema.users).set({ passwordHash: await hashPassword(known) }).where(eq(schema.users.id, s.staff.id));

    // The holder plays the reset: new hash + session purge, committed while the login waits.
    const holder = await holdAccountLock(s.staff.id);
    const loggingIn = track(login(dbB!, s.email, known));
    await holder.waitForBlocked(1);
    await holder.query("update users set password_hash = $1 where id = $2", [await hashPassword("brand-new-password-1"), s.staff.id]);
    await holder.query("delete from sessions where user_id = $1", [s.staff.id]);
    await holder.commit();

    await expect(loggingIn.promise).resolves.toEqual({ ok: false, error: "invalid_credentials" });
    expect(await dbA!.$count(schema.sessions, eq(schema.sessions.userId, s.staff.id))).toBe(0);
  });

  it("does not let a self-service password change overwrite a reset that committed in between", async () => {
    const s = await scenario();
    const known = "known-old-password-789";
    await dbA!.update(schema.users).set({ passwordHash: await hashPassword(known) }).where(eq(schema.users.id, s.staff.id));
    const [membership] = await dbA!.select().from(schema.memberships).where(eq(schema.memberships.userId, s.staff.id));
    const { token } = await createSession(dbA!, s.staff.id, membership.id);

    const holder = await holdAccountLock(s.staff.id);
    const change = track(
      changeOwnPassword(dbB!, { userId: s.staff.id, businessId: s.a.business.id }, token, {
        currentPassword: known,
        newPassword: "attacker-chosen-password",
        confirmPassword: "attacker-chosen-password",
      }),
    );
    await holder.waitForBlocked(1);
    const resetHash = await hashPassword("owner-issued-temp-1");
    await holder.query("update users set password_hash = $1 where id = $2", [resetHash, s.staff.id]);
    await holder.commit();

    await expect(change.promise).rejects.toThrow("changed somewhere else");
    expect(await passwordHashOf(s.staff.id)).toBe(resetHash);
  });
});

describe.skipIf(!dbA)("last-owner invariant under concurrency (PostgreSQL)", () => {
  async function twoOwners() {
    await ensureRoleCatalog(dbA!);
    const a = await seedTestFixture(dbA!);
    await setRole(dbA!, a.user.id, a.business.id, "owner");
    const first = { businessId: a.business.id, userId: a.user.id };
    const { user: other } = await createStaff(dbA!, first, { name: "Second owner", email: `owner2-${randomUUID().slice(0, 8)}@test.local`, role: "owner" });
    const second = { businessId: a.business.id, userId: other.id };
    return { a, first, second };
  }

  async function activeOwners(businessId: string) {
    const rows = await dbA!
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .innerJoin(schema.membershipRoles, eq(schema.membershipRoles.membershipId, schema.memberships.id))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.membershipRoles.roleId))
      .where(and(eq(schema.memberships.businessId, businessId), eq(schema.memberships.active, true), eq(schema.roles.name, "owner")));
    return rows.length;
  }

  async function holdRoster(businessId: string) {
    const holder = await LockHolder.begin(holderDb!.$client);
    await holder.query("select pg_advisory_xact_lock($1::int, hashtext($2))", [ROSTER_LOCK_NAMESPACE, businessId]);
    return holder;
  }

  it("lets only one of two owners demote the other", async () => {
    const t = await twoOwners();
    const holder = await holdRoster(t.a.business.id);
    const one = track(updateStaff(dbA!, t.first, t.second.userId, { name: "Second owner", email: (await emailOf(t.second.userId))!, role: "cashier" }));
    const two = track(updateStaff(dbB!, t.second, t.first.userId, { name: "Test Owner", email: (await emailOf(t.first.userId))!, role: "cashier" }));
    await holder.waitForBlocked(2);
    await holder.commit();

    const results = await Promise.allSettled([one.promise, two.promise]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toContain("only active Owner");
    expect(await activeOwners(t.a.business.id)).toBe(1);
  });

  it("serializes a deactivation against a concurrent demotion of the other owner", async () => {
    const t = await twoOwners();
    const holder = await holdRoster(t.a.business.id);
    const deactivate = track(setStaffActive(dbA!, t.first, t.second.userId, false));
    const demote = track(updateStaff(dbB!, t.second, t.first.userId, { name: "Test Owner", email: (await emailOf(t.first.userId))!, role: "viewer" }));
    await holder.waitForBlocked(2);
    await holder.commit();

    const results = await Promise.allSettled([deactivate.promise, demote.promise]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await activeOwners(t.a.business.id)).toBe(1);
  });

  it("refuses to deactivate, delete or demote the only active owner", async () => {
    const t = await twoOwners();
    await deleteStaff(dbA!, t.first, t.second.userId);
    const { user: manager } = await createStaff(dbA!, t.first, { name: "Manager", email: `mgr-${randomUUID().slice(0, 8)}@test.local`, role: "manager" });
    const managerActor = { businessId: t.a.business.id, userId: manager.id };
    await expect(setStaffActive(dbA!, managerActor, t.first.userId, false)).rejects.toThrow("only active Owner");
    await expect(deleteStaff(dbA!, managerActor, t.first.userId)).rejects.toThrow("only active Owner");
    await expect(
      updateStaff(dbA!, managerActor, t.first.userId, { name: "Test Owner", email: (await emailOf(t.first.userId))!, role: "cashier" }),
    ).rejects.toThrow("only active Owner");
    await expect(setStaffActive(dbA!, t.first, t.first.userId, false)).rejects.toThrow("your own account");
    expect(await activeOwners(t.a.business.id)).toBe(1);
  });

  it("keeps super-admin memberships out of reach of this screen", async () => {
    const t = await twoOwners();
    await setRole(dbA!, t.second.userId, t.a.business.id, "super_admin");
    await expect(resetStaffPassword(dbA!, t.first, t.second.userId)).rejects.toThrow("Super Admin");
    await expect(setStaffActive(dbA!, t.first, t.second.userId, false)).rejects.toThrow("Super Admin");
    await expect(deleteStaff(dbA!, t.first, t.second.userId)).rejects.toThrow("Super Admin");
  });
});

async function emailOf(userId: string) {
  const [row] = await dbA!.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
  return row?.email;
}
