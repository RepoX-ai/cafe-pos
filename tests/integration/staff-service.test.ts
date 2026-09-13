import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb, seedTestFixture, type TestDb } from "./helpers";
import { submitOrder } from "@/server/services/order-service";
import { countStaffAttribution, createStaff, deleteStaff, updateStaff } from "@/server/services/staff-service";
import { auditLogs, orders, roles, sessions, userRoles, users } from "@/lib/db/schema";
import { ROLE_NAMES } from "@/lib/validation/staff";
import type { RoleName } from "@/lib/permissions/permissions";

const db = getTestDb();

/** The role catalog is seeded once per database; tests share one. */
async function ensureRoleCatalog(db: TestDb) {
  await db
    .insert(roles)
    .values([...ROLE_NAMES, "super_admin" as const].map((name) => ({ name })))
    .onConflictDoNothing();
}

async function assignRole(db: TestDb, userId: string, name: RoleName) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  await db.insert(userRoles).values({ userId, roleId: role.id });
}

async function rolesOf(db: TestDb, userId: string) {
  const rows = await db
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.name);
}

function uniqueEmail(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@test.local`;
}

/** A business with an owner actor and one cashier to act on. */
async function seedStaffFixture(db: TestDb) {
  const fixture = await seedTestFixture(db);
  await ensureRoleCatalog(db);
  await assignRole(db, fixture.user.id, "owner");
  const actor = { businessId: fixture.business.id, userId: fixture.user.id };
  const { user: staff } = await createStaff(db, actor, {
    name: "Rina",
    email: uniqueEmail("rina"),
    role: "cashier",
  });
  return { ...fixture, actor, staff };
}

describe.skipIf(!db)("staff service", () => {
  it("edits name, email, and role together", async () => {
    const { actor, staff } = await seedStaffFixture(db!);
    const newEmail = uniqueEmail("rina-dewi");

    await updateStaff(db!, actor, staff.id, { name: "Rina Dewi", email: newEmail, role: "manager" });

    const [saved] = await db!.select().from(users).where(eq(users.id, staff.id));
    expect(saved).toMatchObject({ name: "Rina Dewi", email: newEmail });
    expect(await rolesOf(db!, staff.id)).toEqual(["manager"]);
  });

  it("rejects an email that already belongs to someone else, and a user outside the business", async () => {
    const { actor, staff, user: owner } = await seedStaffFixture(db!);

    await expect(
      updateStaff(db!, actor, staff.id, { name: "Rina", email: owner.email, role: "cashier" }),
    ).rejects.toThrow("already exists");

    const other = await seedStaffFixture(db!);
    await expect(
      updateStaff(db!, actor, other.staff.id, { name: "Nope", email: uniqueEmail("nope"), role: "cashier" }),
    ).rejects.toThrow("User not found");

    // Re-saving a user's own unchanged email is not a clash with itself.
    const [unchanged] = await db!.select().from(users).where(eq(users.id, staff.id));
    await updateStaff(db!, actor, staff.id, { name: "Rina R", email: unchanged.email, role: "cashier" });
    const [saved] = await db!.select().from(users).where(eq(users.id, staff.id));
    expect(saved.name).toBe("Rina R");
  });

  it("won't demote or delete the last active owner", async () => {
    const { actor, staff, user: owner } = await seedStaffFixture(db!);
    const staffActor = { businessId: actor.businessId, userId: staff.id };

    await expect(
      updateStaff(db!, staffActor, owner.id, { name: owner.name, email: owner.email, role: "manager" }),
    ).rejects.toThrow("only active Owner");
    await expect(deleteStaff(db!, staffActor, owner.id)).rejects.toThrow("only active Owner");

    // A second active owner lifts the guard.
    await assignRole(db!, staff.id, "owner");
    await updateStaff(db!, staffActor, owner.id, { name: owner.name, email: owner.email, role: "manager" });
    expect(await rolesOf(db!, owner.id)).toEqual(["manager"]);
  });

  it("won't delete the account you're signed in as", async () => {
    const { actor } = await seedStaffFixture(db!);
    await expect(deleteStaff(db!, actor, actor.userId)).rejects.toThrow("your own account");
  });

  it("counts what a delete would un-attribute, then keeps those records after it", async () => {
    const { actor, staff, menuItem, variant } = await seedStaffFixture(db!);

    const { order } = await submitOrder(
      db!,
      { businessId: actor.businessId, userId: staff.id },
      {
        idempotencyKey: randomUUID(),
        orderType: "dine_in",
        discountTotal: 0,
        lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, modifierOptionIds: [], quantity: 1 }],
      },
    );

    const impact = await countStaffAttribution(db!, actor, staff.id);
    expect(impact.find((entry) => entry.label === "Orders")?.count).toBe(1);

    await db!.insert(sessions).values({
      userId: staff.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    await deleteStaff(db!, actor, staff.id);

    expect(await db!.select().from(users).where(eq(users.id, staff.id))).toHaveLength(0);
    expect(await db!.select().from(userRoles).where(eq(userRoles.userId, staff.id))).toHaveLength(0);
    expect(await db!.select().from(sessions).where(eq(sessions.userId, staff.id))).toHaveLength(0);

    // The order survives the delete — it just no longer names a cashier.
    const [keptOrder] = await db!.select().from(orders).where(eq(orders.id, order.id));
    expect(keptOrder).toMatchObject({ id: order.id, createdBy: null });

    // ...and the audit log still records whose id that was.
    const [logged] = await db!
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, staff.id), eq(auditLogs.action, "user.deleted")));
    expect(logged.beforeSnapshot).toMatchObject({ email: staff.email, roles: ["cashier"] });
  });
});
