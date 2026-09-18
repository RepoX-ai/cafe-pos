import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb, seedTestFixture } from "./helpers";
import { submitOrder } from "@/server/services/order-service";
import { processPrintJob } from "@/server/services/print-service";
import { clearRateLimits, consumeRateLimit } from "@/server/services/rate-limit";
import { menuItemModifierGroups, modifierGroups, modifierOptions, printJobs } from "@/lib/db/schema";

const db = getTestDb();
describe.skipIf(!db)("audit regressions", () => {
  it("rejects omitted variants, unrelated modifiers, and missing required groups", async () => {
    const { business, user, menuItem, variant } = await seedTestFixture(db!);
    const actor = { businessId: business.id, userId: user.id };
    const input = { idempotencyKey: randomUUID(), orderType: "dine_in" as const, discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, modifierOptionIds: [] as string[], quantity: 1 }] };
    await expect(submitOrder(db!, actor, { ...input, lines: [{ ...input.lines[0], menuItemVariantId: null }] })).rejects.toThrow("variant");
    const [group] = await db!.insert(modifierGroups).values({ businessId: business.id, name: "Extras", required: true, maxSelections: 1 }).returning();
    const [option] = await db!.insert(modifierOptions).values({ modifierGroupId: group.id, name: "Egg" }).returning();
    await expect(submitOrder(db!, actor, { ...input, lines: [{ ...input.lines[0], modifierOptionIds: [option.id] }] })).rejects.toThrow("does not belong");
    await db!.insert(menuItemModifierGroups).values({ menuItemId: menuItem.id, modifierGroupId: group.id });
    await expect(submitOrder(db!, actor, input)).rejects.toThrow("number of selections");
    const saved = await submitOrder(db!, actor, { ...input, lines: [{ ...input.lines[0], modifierOptionIds: [option.id] }] });
    expect(saved.order.status).toBe("SUBMITTED");
  });
  it("hands browser receipts back without marking them printed", async () => {
    const { business, user, menuItem, variant } = await seedTestFixture(db!);
    const result = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: randomUUID(), orderType: "dine_in", discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });
    const [job] = await db!.update(printJobs).set({ provider: "browser" }).where(eq(printJobs.orderId, result.order.id)).returning();
    expect(await processPrintJob(db!, job.businessId, job.id)).toMatchObject({ status: "QUEUED", requiresClientAction: "window_print", payload: { orderId: result.order.id } });
    const [saved] = await db!.select().from(printJobs).where(eq(printJobs.id, job.id));
    expect(saved.printedAt).toBeNull();
  });
  it("shares and atomically caps login attempts", async () => {
    const check = { rule: { name: "login-account-ip", limit: 10, windowSeconds: 900 }, key: [randomUUID()] };
    const results = await Promise.all(Array.from({ length: 15 }, () => consumeRateLimit(db!, check)));
    expect(results.filter(Boolean)).toHaveLength(10);
    await clearRateLimits(db!, [check]);
    expect(await consumeRateLimit(db!, check)).toBe(true);
  });
});
