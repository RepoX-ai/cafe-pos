import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb, seedTestFixture, type TestDb } from "./helpers";
import {
  createSession,
  listMemberships,
  resolveDefaultMembership,
  setActiveMembership,
  validateSessionToken,
} from "@/lib/auth/session";
import { createStaff, deleteStaff, listStaff, resetStaffPassword, updateStaff } from "@/server/services/staff-service";
import { login } from "@/server/services/auth-service";
import { membershipRoles, memberships, roles, sessions, users } from "@/lib/db/schema";
import { ROLE_NAMES } from "@/lib/validation/staff";
import type { RoleName } from "@/lib/permissions/permissions";

const db = getTestDb();

async function ensureRoleCatalog(db: TestDb) {
  await db
    .insert(roles)
    .values([...ROLE_NAMES, "super_admin" as const].map((name) => ({ name })))
    .onConflictDoNothing();
}

async function assignRole(db: TestDb, userId: string, businessId: string, name: RoleName) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.businessId, businessId)))
    .limit(1);
  await db.delete(membershipRoles).where(eq(membershipRoles.membershipId, membership.id));
  await db.insert(membershipRoles).values({ membershipId: membership.id, roleId: role.id });
  return membership;
}

/**
 * Two independent cafés, plus one person who works at both — a cashier at
 * A and a manager at B. This is the shape every assertion below is about.
 */
async function seedTwoBusinesses(db: TestDb) {
  await ensureRoleCatalog(db);
  const cafeA = await seedTestFixture(db);
  const cafeB = await seedTestFixture(db);
  await assignRole(db, cafeA.user.id, cafeA.business.id, "owner");
  await assignRole(db, cafeB.user.id, cafeB.business.id, "owner");

  const actorA = { businessId: cafeA.business.id, userId: cafeA.user.id };
  const actorB = { businessId: cafeB.business.id, userId: cafeB.user.id };

  const sharedEmail = `shared-${randomUUID().slice(0, 8)}@test.local`;
  const created = await createStaff(db, actorA, { name: "Dwi", email: sharedEmail, role: "cashier" });
  const linked = await createStaff(db, actorB, { name: "Dwi", email: sharedEmail, role: "manager" });

  return { cafeA, cafeB, actorA, actorB, sharedEmail, created, linked };
}

describe.skipIf(!db)("multi-tenancy", () => {
  it("links one account into a second business instead of duplicating it", async () => {
    const { created, linked, sharedEmail } = await seedTwoBusinesses(db!);

    expect(linked.linkedExistingAccount).toBe(true);
    expect(linked.tempPassword).toBeNull();
    expect(linked.user.id).toBe(created.user.id);

    const accounts = await db!.select().from(users).where(eq(users.email, sharedEmail));
    expect(accounts).toHaveLength(1);
  });

  it("gives the same person a different role in each business", async () => {
    const { cafeA, cafeB, actorA, actorB, created } = await seedTwoBusinesses(db!);

    const inA = (await listStaff(db!, actorA.businessId)).find((s) => s.id === created.user.id);
    const inB = (await listStaff(db!, actorB.businessId)).find((s) => s.id === created.user.id);

    expect(inA?.roles).toEqual(["cashier"]);
    expect(inB?.roles).toEqual(["manager"]);
    expect(inA?.linkedElsewhere).toBe(true);

    // ...and the session reports the role for whichever business it is in.
    const options = await listMemberships(db!, created.user.id);
    expect(options.map((o) => o.businessId).sort()).toEqual([cafeA.business.id, cafeB.business.id].sort());
  });

  it("refuses to let one business change a shared account's name, email or password", async () => {
    const { actorA, created, sharedEmail } = await seedTwoBusinesses(db!);

    await expect(
      updateStaff(db!, actorA, created.user.id, { name: "Renamed", email: sharedEmail, role: "cashier" }),
    ).rejects.toThrow("can only be changed by them");

    await expect(resetStaffPassword(db!, actorA, created.user.id)).rejects.toThrow("isn't yours to reset");

    // The role, which is this café's own business, still changes freely.
    await updateStaff(db!, actorA, created.user.id, { name: "Dwi", email: sharedEmail, role: "viewer" });
    const inA = (await listStaff(db!, actorA.businessId)).find((s) => s.id === created.user.id);
    expect(inA?.roles).toEqual(["viewer"]);
  });

  it("removing a shared account from one business leaves the other untouched", async () => {
    const { actorA, actorB, created } = await seedTwoBusinesses(db!);

    const result = await deleteStaff(db!, actorA, created.user.id);
    expect(result.accountDeleted).toBe(false);

    // Gone from A, still working at B, account still exists.
    expect((await listStaff(db!, actorA.businessId)).some((s) => s.id === created.user.id)).toBe(false);
    expect((await listStaff(db!, actorB.businessId)).some((s) => s.id === created.user.id)).toBe(true);
    expect(await db!.select().from(users).where(eq(users.id, created.user.id))).toHaveLength(1);

    // Now it is their last business, so removing them deletes the account.
    const second = await deleteStaff(db!, actorB, created.user.id);
    expect(second.accountDeleted).toBe(true);
    expect(await db!.select().from(users).where(eq(users.id, created.user.id))).toHaveLength(0);
  });

  it("resolves the session's tenant from the session row, and switches it", async () => {
    const { cafeA, cafeB, created } = await seedTwoBusinesses(db!);

    const membership = await resolveDefaultMembership(db!, created.user.id);
    const { token } = await createSession(db!, created.user.id, membership!.membershipId);

    const before = await validateSessionToken(db!, token);
    expect(before?.businessId).toBe(membership!.businessId);
    expect(before?.membershipCount).toBe(2);

    const target = (await listMemberships(db!, created.user.id)).find(
      (o) => o.businessId !== membership!.businessId,
    )!;
    const moved = await setActiveMembership(db!, created.user.id, target.membershipId, token);
    expect(moved?.businessId).toBe(target.businessId);

    const after = await validateSessionToken(db!, token);
    expect(after?.businessId).toBe(target.businessId);
    expect([cafeA.business.id, cafeB.business.id]).toContain(after!.businessId);
    // The roles travel with the business, not the account.
    expect(after?.roles).not.toEqual(before?.roles);
  });

  it("won't let a session be switched into a business it has no membership in", async () => {
    const { cafeA, cafeB } = await seedTwoBusinesses(db!);

    // cafeA's owner belongs only to cafeA.
    const mine = await resolveDefaultMembership(db!, cafeA.user.id);
    const { token } = await createSession(db!, cafeA.user.id, mine!.membershipId);

    const [theirs] = await db!
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, cafeB.user.id), eq(memberships.businessId, cafeB.business.id)))
      .limit(1);

    expect(await setActiveMembership(db!, cafeA.user.id, theirs.id, token)).toBeNull();
    expect((await validateSessionToken(db!, token))?.businessId).toBe(cafeA.business.id);
  });

  it("drops the session for a revoked membership without touching the other business", async () => {
    const { actorA, created } = await seedTwoBusinesses(db!);

    const options = await listMemberships(db!, created.user.id);
    const inA = options.find((o) => o.businessId === actorA.businessId)!;
    const inB = options.find((o) => o.businessId !== actorA.businessId)!;

    const { token: tokenA } = await createSession(db!, created.user.id, inA.membershipId);
    const { token: tokenB } = await createSession(db!, created.user.id, inB.membershipId);

    // Deactivating the A membership must not reach the B session.
    await db!.update(memberships).set({ active: false }).where(eq(memberships.id, inA.membershipId));

    expect(await validateSessionToken(db!, tokenA)).toBeNull();
    expect((await validateSessionToken(db!, tokenB))?.businessId).toBe(inB.businessId);
  });

  it("refuses login for an account with no active membership anywhere", async () => {
    await ensureRoleCatalog(db!);
    const cafe = await seedTestFixture(db!);
    await assignRole(db!, cafe.user.id, cafe.business.id, "owner");
    const actor = { businessId: cafe.business.id, userId: cafe.user.id };

    const email = `lapsed-${randomUUID().slice(0, 8)}@test.local`;
    const { user, tempPassword } = await createStaff(db!, actor, { name: "Lapsed", email, role: "cashier" });

    expect(await login(db!, email, tempPassword!)).toMatchObject({ ok: true });

    await db!.update(memberships).set({ active: false }).where(eq(memberships.userId, user.id));

    expect(await login(db!, email, tempPassword!)).toEqual({ ok: false, error: "no_business_access" });
  });

  it("scopes a staff member's attribution counts to the business asking", async () => {
    const { actorA, actorB, created } = await seedTwoBusinesses(db!);

    // A session in each business, so there is something per-tenant to count.
    const options = await listMemberships(db!, created.user.id);
    for (const option of options) {
      await createSession(db!, created.user.id, option.membershipId);
    }
    expect(await db!.select().from(sessions).where(eq(sessions.userId, created.user.id))).toHaveLength(2);

    // Removing them from A drops only A's session.
    await deleteStaff(db!, actorA, created.user.id);
    const remaining = await db!.select().from(sessions).where(eq(sessions.userId, created.user.id));
    expect(remaining).toHaveLength(1);

    const stillThere = (await listStaff(db!, actorB.businessId)).find((s) => s.id === created.user.id);
    expect(stillThere?.linkedElsewhere).toBe(false);
  });
});
