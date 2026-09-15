import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { PermissionDeniedError } from "@/lib/permissions/permissions";
import { getTestDb, seedTestFixture } from "./helpers";
import {
  bucketKey,
  consumeRateLimit,
  consumeRateLimits,
  deleteExpiredRateLimitBuckets,
  type RateLimitRule,
} from "@/server/services/rate-limit";
import { submitOrderForUser } from "@/server/services/checkout";

const dbA = getTestDb();
const dbB = getTestDb();
afterAll(async () => Promise.all([dbA?.$client.end(), dbB?.$client.end()]));

const rule = (name: string, limit: number, windowSeconds = 900): RateLimitRule => ({ name: `${name}-${randomUUID()}`, limit, windowSeconds });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!dbA)("shared rate limits (PostgreSQL)", () => {
  it("stops identifier rotation from one client IP", async () => {
    const ipRule = rule("login-ip", 5);
    const accountRule = rule("login-account", 20);
    const ip = "203.0.113.10";

    const outcomes = [];
    for (let i = 0; i < 8; i++) {
      const blocked = await consumeRateLimits(dbA!, [
        { rule: ipRule, key: [ip] },
        { rule: accountRule, key: [`user${i}@example.test`] },
      ]);
      outcomes.push(blocked?.name ?? null);
    }
    expect(outcomes.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(outcomes.slice(5)).toEqual([ipRule.name, ipRule.name, ipRule.name]);
  });

  it("keeps separate per-account allowances for staff sharing one IP", async () => {
    const ipRule = rule("login-ip", 50);
    const accountIpRule = rule("login-account-ip", 3);
    const ip = "198.51.100.7";
    const attempt = (account: string) =>
      consumeRateLimits(dbA!, [
        { rule: ipRule, key: [ip] },
        { rule: accountIpRule, key: [ip, account] },
      ]);

    for (let i = 0; i < 3; i++) expect(await attempt("barista@example.test")).toBeNull();
    expect((await attempt("barista@example.test"))?.name).toBe(accountIpRule.name);
    expect(await attempt("manager@example.test")).toBeNull();
  });

  it("caps one account however many addresses the attempts come from", async () => {
    const accountRule = rule("login-account", 4);
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await consumeRateLimits(dbA!, [{ rule: rule("login-ip", 50), key: [`192.0.2.${i}`] }, { rule: accountRule, key: ["owner@example.test"] }]));
    }
    expect(results.map((r) => r?.name ?? null)).toEqual([null, null, null, null, accountRule.name, accountRule.name]);
  });

  it("allows attempts again once the window expires", async () => {
    const check = { rule: rule("short", 2, 1), key: ["expiring"] };
    expect(await consumeRateLimit(dbA!, check)).toBe(true);
    expect(await consumeRateLimit(dbA!, check)).toBe(true);
    expect(await consumeRateLimit(dbA!, check)).toBe(false);
    await sleep(1_200);
    expect(await consumeRateLimit(dbA!, check)).toBe(true);
  });

  it("does not rewrite a full bucket for blocked attempts", async () => {
    const check = { rule: rule("full", 2), key: ["blocked"] };
    await consumeRateLimit(dbA!, check);
    await consumeRateLimit(dbA!, check);
    const version = async () =>
      (await dbA!.execute<{ xmin: string; count: number }>(sql`select xmin::text as xmin, count from login_attempts where key_hash = ${bucketKey(check)}`)).rows[0];
    const before = await version();
    for (let i = 0; i < 5; i++) expect(await consumeRateLimit(dbA!, check)).toBe(false);
    expect(await version()).toEqual(before);
    expect(before.count).toBe(2);
  });

  it("admits exactly the limit under concurrent requests on separate connections", async () => {
    const check = { rule: rule("concurrent", 7), key: ["race"] };
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => consumeRateLimit(i % 2 ? dbA! : dbB!, check)));
    expect(results.filter(Boolean)).toHaveLength(7);
  });

  it("cleans up only expired buckets", async () => {
    const expired = { rule: rule("cleanup-expired", 5, 1), key: ["old"] };
    const live = { rule: rule("cleanup-live", 5, 900), key: ["new"] };
    await consumeRateLimit(dbA!, expired);
    await consumeRateLimit(dbA!, live);
    await sleep(1_200);
    while ((await deleteExpiredRateLimitBuckets(dbA!, 500)) === 500);
    const remaining = await dbA!.select().from(schema.loginAttempts).where(sql`${schema.loginAttempts.keyHash} in (${bucketKey(expired)}, ${bucketKey(live)})`);
    expect(remaining.map((r) => r.keyHash)).toEqual([bucketKey(live)]);
  });
});

describe.skipIf(!dbA)("checkout throttling (PostgreSQL)", () => {
  it("throttles new checkouts but never idempotent retries or permission checks", async () => {
    const { business, user, menuItem, variant } = await seedTestFixture(dbA!, { openingStock: "1000" });
    const cashier = { id: user.id, businessId: business.id, roles: ["cashier" as const] };
    const checkoutRule = rule("checkout", 1, 900);
    const order = (idempotencyKey: string) => ({
      idempotencyKey,
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    const first = await submitOrderForUser(dbA!, cashier, order("checkout-1"), { checkoutRule });
    expect(first).toMatchObject({ ok: true, idempotent: false });

    const second = await submitOrderForUser(dbA!, cashier, order("checkout-2"), { checkoutRule });
    expect(second).toEqual({ ok: false, error: expect.stringMatching(/Too many orders/) });

    const retry = await submitOrderForUser(dbA!, cashier, order("checkout-1"), { checkoutRule });
    expect(retry).toMatchObject({ ok: true, idempotent: true });
    if (first.ok && retry.ok) expect(retry.orderId).toBe(first.orderId);

    // A role without orders:create is refused before throttling is even consulted.
    const viewer = { ...cashier, roles: ["viewer" as const] };
    await expect(submitOrderForUser(dbA!, viewer, order("checkout-3"), { checkoutRule })).rejects.toThrow(PermissionDeniedError);

    const orders = await dbA!.select().from(schema.orders).where(eq(schema.orders.businessId, business.id));
    expect(orders).toHaveLength(1);
  });
});
