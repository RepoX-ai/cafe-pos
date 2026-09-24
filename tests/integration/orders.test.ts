import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { businesses, ingredients, menuItems, menuItemVariants, recipeLines, recipes } from "@/lib/db/schema";
import { getTestDb, seedTestFixture } from "./helpers";
import { submitOrder, cancelOrder, getOrderById } from "@/server/services/order-service";
import { InsufficientStockError } from "@/server/services/inventory-service";
import { createAndFinalizePurchase } from "@/server/services/purchase-service";

const db = getTestDb();

describe.skipIf(!db)("order submission (integration)", () => {
  it("refuses a stale reviewed total without deducting stock", async () => {
    const fx = await seedTestFixture(db!);
    const actor = { businessId: fx.business.id, userId: fx.user.id };
    const input = {
      idempotencyKey: "reviewed-total-order", orderType: "dine_in" as const, discountTotal: 0,
      expectedTotal: 19_000,
      lines: [{ menuItemId: fx.menuItem.id, menuItemVariantId: fx.variant.id, quantity: 1, modifierOptionIds: [] }],
    };
    await expect(submitOrder(db!, actor, input)).rejects.toThrow(/Prices or charges have changed/);
    const [unchanged] = await db!.select().from(ingredients).where(eq(ingredients.id, fx.ingredient.id));
    expect(Number(unchanged.currentQuantityBaseUnits)).toBe(1000);
    const saved = await submitOrder(db!, actor, { ...input, expectedTotal: 20_000 });
    // A lost-response retry returns the saved sale even if catalog prices change.
    await db!.update(menuItemVariants).set({ price: 21_000 }).where(eq(menuItemVariants.id, fx.variant.id));
    const retried = await submitOrder(db!, actor, { ...input, expectedTotal: 20_000 });
    expect(retried.idempotent).toBe(true);
    expect(retried.order.id).toBe(saved.order.id);
  });

  it("charges an inclusive-tax menu price once and snapshots net profit and receipt charges", async () => {
    const fx = await seedTestFixture(db!, { costPerBaseUnit: "10" });
    await db!.update(businesses).set({ taxConfig: JSON.stringify({ percent: 11, inclusive: true }), serviceChargePercent: "10" }).where(eq(businesses.id, fx.business.id));
    await db!.update(menuItemVariants).set({ price: 111_000 }).where(eq(menuItemVariants.id, fx.variant.id));
    const { order } = await submitOrder(db!, { businessId: fx.business.id, userId: fx.user.id }, {
      idempotencyKey: "inclusive-tax-order", orderType: "dine_in", discountTotal: 0, cashReceived: 130_000,
      lines: [{ menuItemId: fx.menuItem.id, menuItemVariantId: fx.variant.id, quantity: 1, modifierOptionIds: [] }],
    });
    expect(order).toMatchObject({ subtotal: 111_000, taxTotal: 11_000, serviceChargeTotal: 11_100, total: 122_100, changeDue: 7_900, grossProfit: 99_800 });
    const detail = await getOrderById(db!, fx.business.id, order.id);
    expect(detail!.lines[0].grossProfitSnapshot).toBe(99_800);
    expect(detail!.printJobs[0].payloadSnapshot).toMatchObject({ taxIncluded: true, tax: 11_000, serviceCharge: 11_100, total: 122_100 });
  });

  it("rejects a stale POS order after a variant loses its ingredient recipe", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);
    const [recipe] = await db!.select({ id: recipes.id }).from(recipes).where(eq(recipes.menuItemVariantId, variant.id));
    await db!.delete(recipeLines).where(eq(recipeLines.recipeId, recipe.id));

    await expect(submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: "unfinished-recipe-order",
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    })).rejects.toThrow(/no completed recipe/);
  });

  it("consumes recipe ingredients and records COGS/gross profit", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!, {
      openingStock: "1000",
      costPerBaseUnit: "10",
    });

    const result = await submitOrder(
      db!,
      { businessId: business.id, userId: user.id },
      {
        idempotencyKey: "test-key-1",
        orderType: "dine_in",
        discountTotal: 0,
        lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 2, modifierOptionIds: [] }],
      },
    );

    expect(result.idempotent).toBe(false);
    expect(result.order.status).toBe("SUBMITTED");
    // 2 units x 20g/unit x Rp10/g = Rp400 COGS; 2 x Rp20,000 = Rp40,000 subtotal
    expect(result.order.subtotal).toBe(40_000);
    expect(result.order.cogsTotal).toBe(400);
    expect(result.order.grossProfit).toBe(40_000 - 400);

    const detail = await getOrderById(db!, business.id, result.order.id);
    expect(detail?.printJobs.length).toBe(1);
    expect(detail?.printJobs[0].status).toBe("QUEUED");
  });

  it("derives the change from the order total and stores both sides of a cash tender", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);

    const result = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: "cash-key-1",
      orderType: "dine_in",
      discountTotal: 0,
      cashReceived: 50_000,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    expect(result.order.cashReceived).toBe(50_000);
    expect(result.order.changeDue).toBe(50_000 - result.order.total);

    const [job] = (await getOrderById(db!, business.id, result.order.id))!.printJobs;
    expect(job.payloadSnapshot).toMatchObject({ cashReceived: 50_000, changeDue: 50_000 - result.order.total });
  });

  it("leaves cash and change null on a non-cash order", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);

    const result = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: "cash-key-2",
      orderType: "dine_in",
      paymentMethodLabel: "qris",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    expect(result.order.cashReceived).toBeNull();
    expect(result.order.changeDue).toBeNull();
  });

  it("rejects a cash tender smaller than the order total", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);

    await expect(
      submitOrder(db!, { businessId: business.id, userId: user.id }, {
        idempotencyKey: "cash-key-3",
        orderType: "dine_in",
        discountTotal: 0,
        cashReceived: 1,
        lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
      }),
    ).rejects.toThrow(/less than the order total/);
  });

  it("returns the same order on a duplicate idempotency key instead of creating a second one", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!);
    const key = "dup-key";

    const first = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: key,
      orderType: "takeaway",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    const second = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: key,
      orderType: "takeaway",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    expect(second.idempotent).toBe(true);
    expect(second.order.id).toBe(first.order.id);
  });

  it("sells an item with no variants directly off its base price, with no COGS", async () => {
    const { business, user } = await seedTestFixture(db!);
    const [menuItem] = await db!.insert(menuItems).values({ businessId: business.id, name: "Untracked snack", basePrice: 15000, tracksInventory: false }).returning();

    const result = await submitOrder(
      db!,
      { businessId: business.id, userId: user.id },
      {
        idempotencyKey: "no-variant-key",
        orderType: "dine_in",
        discountTotal: 0,
        lines: [{ menuItemId: menuItem.id, quantity: 3, modifierOptionIds: [] }],
      },
    );

    expect(result.order.status).toBe("SUBMITTED");
    expect(result.order.subtotal).toBe(menuItem.basePrice * 3);
    expect(result.order.cogsTotal).toBe(0); // no recipe without a variant

    const detail = await getOrderById(db!, business.id, result.order.id);
    expect(detail?.lines[0].menuItemVariantId).toBeNull();
    expect(detail?.lines[0].variantNameSnapshot).toBeNull();
  });

  it("blocks submission when stock is insufficient", async () => {
    const { business, user, variant, menuItem } = await seedTestFixture(db!, { openingStock: "5" }); // needs 20g/unit

    await expect(
      submitOrder(db!, { businessId: business.id, userId: user.id }, {
        idempotencyKey: "insufficient-key",
        orderType: "dine_in",
        discountTotal: 0,
        lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
      }),
    ).rejects.toThrow(InsufficientStockError);
  });

  it("reverses ingredient consumption on cancellation", async () => {
    const { business, user, variant, menuItem, ingredient } = await seedTestFixture(db!, { openingStock: "1000" });

    const submitted = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: "cancel-key",
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 3, modifierOptionIds: [] }],
    });

    const cancelled = await cancelOrder(db!, { businessId: business.id, userId: user.id }, submitted.order.id, "Customer changed mind");
    expect(cancelled.status).toBe("CANCELLED");

    const [row] = await db!.select().from(ingredients).where(eq(ingredients.id, ingredient.id));
    expect(Number(row.currentQuantityBaseUnits)).toBe(1000); // fully restored
  });

  it("cancelling twice does not double-reverse stock", async () => {
    const { business, user, variant, menuItem, ingredient } = await seedTestFixture(db!, { openingStock: "1000" });

    const submitted = await submitOrder(db!, { businessId: business.id, userId: user.id }, {
      idempotencyKey: "double-cancel-key",
      orderType: "dine_in",
      discountTotal: 0,
      lines: [{ menuItemId: menuItem.id, menuItemVariantId: variant.id, quantity: 1, modifierOptionIds: [] }],
    });

    await cancelOrder(db!, { businessId: business.id, userId: user.id }, submitted.order.id, "first");
    await cancelOrder(db!, { businessId: business.id, userId: user.id }, submitted.order.id, "second");

    const [row] = await db!.select().from(ingredients).where(eq(ingredients.id, ingredient.id));
    expect(Number(row.currentQuantityBaseUnits)).toBe(1000);
  });

  it("purchase receipts increase stock and recompute weighted average cost", async () => {
    const { business, user, ingredient } = await seedTestFixture(db!, { openingStock: "100", costPerBaseUnit: "10" });

    await createAndFinalizePurchase(db!, { businessId: business.id, userId: user.id }, {
      purchaseDate: new Date().toISOString().slice(0, 10),
      lines: [
        {
          ingredientId: ingredient.id,
          quantityPurchased: 100,
          purchaseUnit: "g",
          conversionToBaseUnits: 1,
          unitPurchaseCost: 14,
        },
      ],
    });

    const [row] = await db!.select().from(ingredients).where(eq(ingredients.id, ingredient.id));
    expect(Number(row.currentQuantityBaseUnits)).toBe(200);
    expect(Number(row.averageCostPerBaseUnit)).toBe(12); // (100*10 + 100*14) / 200
  });
});
