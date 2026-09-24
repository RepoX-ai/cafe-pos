import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/client";
import { orders, orderLines, printJobs } from "@/lib/db/schema";
import { submitOrderInputSchema, type SubmitOrderInput } from "@/lib/validation/order";
import { loadOrderCatalog } from "@/server/services/order-consumption";
import { submitOrder } from "@/server/services/order-service";

vi.mock("@/server/services/order-consumption", () => ({ loadOrderCatalog: vi.fn() }));

// Exercise the real checkout calculations and snapshots with a small DB
// double. Transaction isolation and actual SQL remain integration coverage.
function database() {
  const written = new Map<unknown, unknown>();
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{
      id: "business", name: "Test cafe", orderNumberPrefix: "TEST",
      taxConfig: JSON.stringify({ percent: 11, inclusive: true }), serviceChargePercent: "10",
    }] }) }) }),
    update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [{ lastNumber: 1 }] }) }) })),
    insert: vi.fn((table: unknown) => ({ values: (data: unknown) => {
      written.set(table, data);
      return { returning: async () => [{ id: "order", createdAt: new Date(), ...(data as object) }] };
    } })),
  };
  const db = { transaction: (run: (connection: typeof tx) => unknown) => run(tx) } as unknown as Database;
  return { db, tx, written };
}

const input: SubmitOrderInput = {
  idempotencyKey: "pricing-test", orderType: "dine_in", discountTotal: 0,
  expectedTotal: 122_100, cashReceived: 130_000,
  lines: [{ menuItemId: "item", menuItemVariantId: null, quantity: 1, modifierOptionIds: [] }],
};

beforeEach(() => {
  vi.mocked(loadOrderCatalog).mockResolvedValue({
    variants: new Map(), groupsByItem: new Map(), options: new Map(),
    recipeLinesByVariant: new Map(), modifierLinesByOption: new Map(),
    baseItems: new Map([["item", {
      menuItemId: "item", menuItemName: "Coffee", menuItemActive: true,
      basePrice: 111_000, categoryName: null, variantCount: 0,
    }]]),
  });
});

describe("checkout pricing", () => {
  it("saves the inclusive total, change, net profit, and receipt breakdown", async () => {
    const { db, written } = database();
    const result = await submitOrder(db, { businessId: "business", userId: "user" }, input, { idempotencyKeyChecked: true });
    expect(result.order).toMatchObject({ total: 122_100, taxTotal: 11_000, serviceChargeTotal: 11_100, grossProfit: 100_000, changeDue: 7_900 });
    expect(written.get(orders)).toMatchObject({ total: 122_100 });
    expect(written.get(orderLines)).toMatchObject([{ grossProfitSnapshot: 100_000 }]);
    expect(written.get(printJobs)).toMatchObject({ payloadSnapshot: { taxIncluded: true, serviceCharge: 11_100, total: 122_100 } });
  });

  it.each([120_000, 125_000])("rejects a stale reviewed amount of %s before writing", async (expectedTotal) => {
    const { db, tx } = database();
    await expect(submitOrder(db, { businessId: "business", userId: "user" }, { ...input, expectedTotal }, { idempotencyKeyChecked: true })).rejects.toThrow(/Prices or charges have changed/);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("preserves compatibility with saved pending requests from older clients", async () => {
    const { db } = database();
    const result = await submitOrder(db, { businessId: "business", userId: "user" }, { ...input, expectedTotal: undefined }, { idempotencyKeyChecked: true });
    expect(result.order.total).toBe(122_100);
  });

  it("keeps the reviewed amount through request validation and rejects invalid money", () => {
    const valid = { ...input, lines: [{ ...input.lines[0], menuItemId: "00000000-0000-4000-8000-000000000001" }] };
    expect(submitOrderInputSchema.parse(valid).expectedTotal).toBe(122_100);
    expect(submitOrderInputSchema.safeParse({ ...valid, expectedTotal: -1 }).success).toBe(false);
  });
});
