import { describe, expect, it, vi } from "vitest";

/**
 * Every exported Server Action that changes café data must reject a stale
 * page scope before touching the database. A new action fails this test
 * until it either checks the scope or is listed as exempt below with a
 * reason.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn(), unstable_cache: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
// Any database access before the scope check fails the test.
vi.mock("@/lib/db/client", () => {
  const trap = new Proxy({}, { get: (_t, prop) => { throw new Error(`database touched (${String(prop)}) before the scope check`); } });
  return { db: trap, reportDb: trap };
});
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(async () => ({
    id: "user-1",
    membershipId: "membership-konichiwa",
    businessId: "konichiwa",
    businessName: "Konichiwa",
    name: "Owner",
    email: "owner@test.local",
    active: true,
    roles: ["owner"],
    membershipCount: 2,
  })),
}));

import { actionScopeFor, STALE_SCOPE_MESSAGE } from "@/lib/auth/action-scope";
import { matchesCheckoutScope } from "@/lib/auth/checkout-scope";

const EXEMPT: Record<string, string> = {
  testPrinterConnectionAction: "reads printer reachability, writes nothing",
  staffDeletionImpactAction: "read-only count shown in the delete dialog",
  submitOrderAction: "has its own scope guard from the POS checkout fix (tests/unit/submit-order-action-cache.test.ts)",
  retryDevicePrintAction: "bound to an existing print job id in the session's café; never creates tenant data",
  reportDevicePrintResultAction: "bound to a one-time attempt token issued for that print job",
};

const modules = {
  expenses: () => import("@/app/(dashboard)/expenses/actions"),
  settings: () => import("@/app/(dashboard)/settings/actions"),
  staff: () => import("@/app/(dashboard)/settings/staff/actions"),
  purchases: () => import("@/app/(dashboard)/purchases/actions"),
  ingredients: () => import("@/app/(dashboard)/ingredients/actions"),
  inventory: () => import("@/app/(dashboard)/inventory/actions"),
  waste: () => import("@/app/(dashboard)/waste/actions"),
  orders: () => import("@/app/(dashboard)/orders/actions"),
  menu: () => import("@/app/(dashboard)/menu/actions"),
  menuBulk: () => import("@/app/(dashboard)/menu/bulk-actions"),
  recipe: () => import("@/app/(dashboard)/menu/[id]/recipe/actions"),
  pos: () => import("@/app/pos/actions"),
};

describe("stale page scope", () => {
  it("uses the same scope format as the POS checkout guard", () => {
    const user = { id: "user-1", businessId: "konichiwa" };
    expect(matchesCheckoutScope(user, actionScopeFor(user))).toBe(true);
  });

  for (const [area, load] of Object.entries(modules)) {
    it(`every ${area} action rejects a Matsudon scope on a Konichiwa session`, async () => {
      const exported = Object.entries(await load()).filter(([, value]) => typeof value === "function");
      const guarded = exported.filter(([name]) => !(name in EXEMPT));
      expect(guarded.length).toBeGreaterThan(0);

      for (const [name, action] of guarded) {
        const result = await (action as (...args: unknown[]) => Promise<unknown>)("matsudon:user-1", undefined, new FormData(), undefined);
        expect(result, name).toEqual({ ok: false, error: STALE_SCOPE_MESSAGE, scopeChanged: true });
      }
    });
  }

  it("rejects a missing or malformed scope", async () => {
    const { createExpenseAction } = await modules.expenses();
    for (const scope of [undefined, null, "", "konichiwa", "konichiwa:user-2", { businessId: "konichiwa" }]) {
      expect(await createExpenseAction(scope, undefined, new FormData())).toMatchObject({ ok: false, scopeChanged: true });
    }
  });
});
