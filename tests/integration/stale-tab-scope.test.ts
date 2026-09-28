import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two tabs share one session. Tab 1 renders a Matsudon form; tab 2 switches
 * the session to Konichiwa; tab 1 then submits. The real actions run
 * against a real session row, so this exercises the same path a browser
 * would: session lookup → permission → scope check → service.
 */

const session = vi.hoisted(() => ({ token: "" }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db/client", async () => {
  const { getTestDb } = await import("./helpers");
  const db = getTestDb();
  return { db, reportDb: db };
});
vi.mock("@/lib/auth/current-user", async () => {
  const { db } = await import("@/lib/db/client");
  const { validateSessionToken } = await import("@/lib/auth/session");
  const getCurrentUser = () => validateSessionToken(db as never, session.token);
  return {
    getCurrentUser,
    requireCurrentUser: async () => {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");
      return user;
    },
  };
});

import { getTestDb, seedTestFixture, type TestDb } from "./helpers";
import { createSession, setActiveMembership, validateSessionToken } from "@/lib/auth/session";
import { actionScopeFor, STALE_SCOPE_MESSAGE } from "@/lib/auth/action-scope";
import { businesses, expenses, ingredients, membershipRoles, memberships, roles } from "@/lib/db/schema";
import { ROLE_NAMES } from "@/lib/validation/staff";
import { createExpenseAction } from "@/app/(dashboard)/expenses/actions";
import { updateSettingsAction } from "@/app/(dashboard)/settings/actions";
import { createIngredientAction, setIngredientActiveAction } from "@/app/(dashboard)/ingredients/actions";

const db = getTestDb();

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function grantOwner(db: TestDb, membershipId: string) {
  await db.insert(roles).values([...ROLE_NAMES, "super_admin" as const].map((name) => ({ name }))).onConflictDoNothing();
  const [owner] = await db.select().from(roles).where(eq(roles.name, "owner")).limit(1);
  await db.insert(membershipRoles).values({ membershipId, roleId: owner.id }).onConflictDoNothing();
}

/** One owner who belongs to both cafés, signed in with Matsudon active. */
async function seedTwoCafes(db: TestDb) {
  const matsudon = await seedTestFixture(db);
  const konichiwa = await seedTestFixture(db);
  await db.update(businesses).set({ name: `Matsudon ${matsudon.business.id.slice(0, 6)}` }).where(eq(businesses.id, matsudon.business.id));
  await db.update(businesses).set({ name: `Konichiwa ${konichiwa.business.id.slice(0, 6)}` }).where(eq(businesses.id, konichiwa.business.id));

  const [secondMembership] = await db
    .insert(memberships)
    .values({ userId: matsudon.user.id, businessId: konichiwa.business.id })
    .returning();
  await grantOwner(db, matsudon.membership.id);
  await grantOwner(db, secondMembership.id);

  const { token } = await createSession(db, matsudon.user.id, matsudon.membership.id);
  session.token = token;
  const renderedUser = await validateSessionToken(db, token);
  if (!renderedUser) throw new Error("session did not validate");

  const switchToKonichiwa = async () => {
    const moved = await setActiveMembership(db, matsudon.user.id, secondMembership.id, token);
    expect(moved?.businessId).toBe(konichiwa.business.id);
    const now = await validateSessionToken(db, token);
    return actionScopeFor(now!);
  };

  return { matsudon, konichiwa, matsudonScope: actionScopeFor(renderedUser), switchToKonichiwa };
}

const expenseFields = {
  category: "electricity",
  amount: "125000",
  expenseDate: "2026-09-28",
  payee: "PLN",
  referenceNumber: "",
  notes: "typed on the Matsudon page",
};

describe.skipIf(!db)("stale café tabs", () => {
  beforeEach(() => {
    session.token = "";
  });

  it("rejects a Matsudon expense form after the session moved to Konichiwa, writing nothing anywhere", async () => {
    const { matsudon, konichiwa, matsudonScope, switchToKonichiwa } = await seedTwoCafes(db!);
    await switchToKonichiwa();

    const result = await createExpenseAction(matsudonScope, undefined, form({ ...expenseFields, idempotencyKey: crypto.randomUUID() }));

    expect(result).toEqual({ ok: false, error: STALE_SCOPE_MESSAGE, scopeChanged: true });
    for (const businessId of [matsudon.business.id, konichiwa.business.id]) {
      expect(await db!.select().from(expenses).where(eq(expenses.businessId, businessId))).toHaveLength(0);
    }
  });

  it("rejects stale Matsudon settings instead of renaming Konichiwa", async () => {
    const { matsudon, konichiwa, matsudonScope, switchToKonichiwa } = await seedTwoCafes(db!);
    const [before] = await db!.select().from(businesses).where(eq(businesses.id, konichiwa.business.id));
    await switchToKonichiwa();

    const result = await updateSettingsAction(
      matsudonScope,
      undefined,
      form({ name: "Matsudon (edited)", orderNumberPrefix: "MTS", receiptFooter: "Arigato", taxPercent: "0", serviceChargePercent: "0" }),
    );

    expect(result).toMatchObject({ ok: false, scopeChanged: true });
    const [after] = await db!.select().from(businesses).where(eq(businesses.id, konichiwa.business.id));
    expect(after).toEqual(before);
    const [matsudonRow] = await db!.select().from(businesses).where(eq(businesses.id, matsudon.business.id));
    expect(matsudonRow.name).not.toBe("Matsudon (edited)");
  });

  it("rejects a stale archive toggle as a returned error, not a thrown one", async () => {
    const { matsudon, matsudonScope, switchToKonichiwa } = await seedTwoCafes(db!);
    await switchToKonichiwa();

    const result = await setIngredientActiveAction(matsudonScope, form({ id: matsudon.ingredient.id, active: "false" }));

    expect(result).toMatchObject({ ok: false, scopeChanged: true });
    const [row] = await db!.select().from(ingredients).where(eq(ingredients.id, matsudon.ingredient.id));
    expect(row.active).toBe(true);
  });

  it("accepts the same forms once they were rendered for Konichiwa, and writes only to Konichiwa", async () => {
    const { matsudon, konichiwa, switchToKonichiwa } = await seedTwoCafes(db!);
    const konichiwaScope = await switchToKonichiwa();

    const expense = await createExpenseAction(konichiwaScope, undefined, form({ ...expenseFields, idempotencyKey: crypto.randomUUID() }));
    expect(expense).toEqual({ ok: true });

    const settings = await updateSettingsAction(
      konichiwaScope,
      undefined,
      form({ name: "Konichiwa Ramen", orderNumberPrefix: "KON", receiptFooter: "", taxPercent: "0", serviceChargePercent: "0" }),
    );
    expect(settings).toEqual({ ok: true });

    const ingredient = await createIngredientAction(
      konichiwaScope,
      undefined,
      form({ name: "Nori", sku: "", category: "", baseUnit: "piece", notes: "" }),
    );
    expect(ingredient).toEqual({ ok: true });

    expect(await db!.select().from(expenses).where(eq(expenses.businessId, konichiwa.business.id))).toHaveLength(1);
    expect(await db!.select().from(expenses).where(eq(expenses.businessId, matsudon.business.id))).toHaveLength(0);
    const [konichiwaRow] = await db!.select().from(businesses).where(eq(businesses.id, konichiwa.business.id));
    expect(konichiwaRow.name).toBe("Konichiwa Ramen");
    const nori = await db!
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.name, "Nori"), eq(ingredients.businessId, konichiwa.business.id)));
    expect(nori).toHaveLength(1);
    expect(await db!.select().from(ingredients).where(and(eq(ingredients.name, "Nori"), eq(ingredients.businessId, matsudon.business.id)))).toHaveLength(0);
  });

  it("never lets the submitted scope pick the café: a Konichiwa scope on a Matsudon session is rejected", async () => {
    const { konichiwa, matsudon } = await seedTwoCafes(db!);
    const forgedScope = `${konichiwa.business.id}:${matsudon.user.id}`;

    const result = await createExpenseAction(forgedScope, undefined, form({ ...expenseFields, idempotencyKey: crypto.randomUUID() }));

    expect(result).toMatchObject({ ok: false, scopeChanged: true });
    expect(await db!.select().from(expenses).where(eq(expenses.businessId, konichiwa.business.id))).toHaveLength(0);
  });
});
