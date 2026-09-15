import { describe, expect, it } from "vitest";
import { getTestDb, seedTestFixture } from "./helpers";
import { submitOrder, cancelOrder } from "@/server/services/order-service";
import { getSalesSummary } from "@/server/services/reports-service";
import { shiftBusinessDate, todayInBusinessTimezone } from "@/lib/dates/dates";

const db = getTestDb();

describe.skipIf(!db)("reports (integration)", () => {
  it("excludes cancelled orders from the sales summary", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!, { openingStock: "1000", costPerBaseUnit: "10" });
    // A day either side of today, so the orders created now are in range even at Jakarta midnight.
    const today = todayInBusinessTimezone();
    const range = { from: shiftBusinessDate(today, -1), to: shiftBusinessDate(today, 1) };

    const kept = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: "report-kept",
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    const cancelled = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: "report-cancelled",
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });
    await cancelOrder(db!, { businessId: business.id, userId: user.id }, cancelled.order.id, "test");

    const summary = await getSalesSummary(db!, business.id, range);

    expect(summary.orderCount).toBe(1);
    expect(summary.totalSales).toBe(kept.order.total);
    expect(summary.cancelledRefundedAmount).toBe(cancelled.order.total);
  });
});
