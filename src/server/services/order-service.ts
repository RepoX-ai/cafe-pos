import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  businesses,
  orderIngredientConsumption,
  orderLineModifiers,
  orderLines,
  orders,
  printJobs,
} from "@/lib/db/schema";
import { microsToRupiah, multiplyQuantityByRate, sumRupiah } from "@/lib/money/money";
import { calculateServiceCharge, calculateTax, parseTaxConfig } from "@/lib/settings/tax";
import type { SubmitOrderInput } from "@/lib/validation/order";
import { recordAuditLog } from "./audit";
import {
  calculateLineIngredientDemand,
  getOrderSelectionRules,
  getMenuItemForOrder,
  getModifierOptionsById,
  getVariantWithItem,
} from "./order-consumption";
import { insertMovementAndApplyStock, lockIngredientForUpdate, InsufficientStockError } from "./inventory-service";
import type { ActorContext } from "./ingredient-service";

export class OrderValidationError extends Error {}

interface PreparedLine {
  menuItemId: string;
  menuItemVariantId: string | null;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  quantity: number;
  unitPriceSnapshot: number; // variant price + modifier adjustments
  lineTotal: number;
  notes?: string;
  modifiers: Array<{ modifierOptionId: string; name: string; priceAdjustment: number; cogsAdjustment: number }>;
  cogsSnapshot: number;
  grossProfitSnapshot: number;
  consumption: Array<{
    ingredientId: string;
    quantityBaseUnits: number; // total for this line (per-unit x quantity)
    unitCostSnapshot: string;
    totalCost: number;
  }>;
}

async function generateOrderNumber(tx: Database, businessId: string, prefix: string): Promise<string> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.businessId, businessId));
  const next = (row?.count ?? 0) + 1;
  return `${prefix}-${String(next).padStart(5, "0")}`;
}

function isUniqueViolation(error: unknown, constraintHint: string): boolean {
  const err = error as { code?: string; constraint?: string; message?: string };
  return err?.code === "23505" && (err.constraint?.includes(constraintHint) || err.message?.includes(constraintHint) || false);
}

/**
 * The order-submission transaction (PRD §6.9, §8). Runs entirely inside one
 * DB transaction: idempotency check, menu/recipe/stock revalidation,
 * snapshotting, ingredient consumption + inventory movements, COGS/profit
 * calculation, a queued print job, and an audit log — or nothing at all if
 * any step fails.
 */
export async function submitOrder(
  db: Database,
  actor: ActorContext,
  input: SubmitOrderInput,
): Promise<{ order: typeof orders.$inferSelect; idempotent: boolean }> {
  // Order-number generation races under concurrent submissions; retry a
  // few times on a unique-constraint conflict rather than failing the
  // whole checkout for what is, in practice, extremely rare contention.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptSubmitOrder(db, actor, input);
    } catch (error) {
      if (isUniqueViolation(error, "order_number")) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not generate a unique order number");
}

async function attemptSubmitOrder(db: Database, actor: ActorContext, input: SubmitOrderInput) {
  return db.transaction(async (tx) => {
    // Serialize submissions per business before checking keys and allocating order numbers.
    await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, actor.businessId)).for("update");
    const [existing] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.businessId, actor.businessId), eq(orders.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing) {
      return { order: existing, idempotent: true };
    }

    const [business] = await tx.select().from(businesses).where(eq(businesses.id, actor.businessId)).limit(1);
    if (!business) throw new OrderValidationError("Business not found");

    // --- Validate lines, price them, and compute ingredient demand ---------
    const prepared: PreparedLine[] = [];
    const totalDemandByIngredient = new Map<
      string,
      { ingredientName: string; baseUnit: "gram" | "millilitre" | "piece"; quantity: number; costPerBaseUnit: string }
    >();

    for (const line of input.lines) {
      const rules = await getOrderSelectionRules(tx, actor.businessId, line.menuItemId);
      if (!line.menuItemVariantId && rules.variants.length > 0) {
        throw new OrderValidationError("Choose an available variant for this item.");
      }
      // Two pricing paths: a selected variant (the normal case), or — when
      // the item has no variants at all — the item's own base price. An
      // item sold the second way has no recipe row to deduct stock or
      // compute COGS from (recipes are keyed by menu_item_variant_id), so
      // it never affects inventory/COGS regardless of tracksInventory.
      let itemName: string;
      let variantName: string | null = null;
      let basePrice: number;
      let hasRecipe = false;

      if (line.menuItemVariantId) {
        const variant = await getVariantWithItem(tx, actor.businessId, line.menuItemVariantId);
        if (!variant || variant.menuItemId !== line.menuItemId) {
          throw new OrderValidationError("A menu item in this order no longer exists.");
        }
        if (!variant.menuItemActive || !variant.variantActive) {
          throw new OrderValidationError(`"${variant.menuItemName}" is not currently available.`);
        }
        itemName = variant.menuItemName;
        variantName = variant.variantName;
        basePrice = variant.variantPrice;
        hasRecipe = variant.tracksInventory;
      } else {
        const item = await getMenuItemForOrder(tx, actor.businessId, line.menuItemId);
        if (!item) {
          throw new OrderValidationError("A menu item in this order no longer exists.");
        }
        if (!item.menuItemActive) {
          throw new OrderValidationError(`"${item.menuItemName}" is not currently available.`);
        }
        itemName = item.menuItemName;
        basePrice = item.basePrice;
      }

      const modifierOptions = await getModifierOptionsById(tx, actor.businessId, line.modifierOptionIds);
      if (modifierOptions.length !== line.modifierOptionIds.length) {
        throw new OrderValidationError("One or more selected modifiers are no longer available.");
      }
      const inactiveModifier = modifierOptions.find((m) => !m.active);
      if (inactiveModifier) {
        throw new OrderValidationError(`"${inactiveModifier.name}" is no longer available.`);
      }

      const assigned = new Map(rules.groups.filter((g) => g.active).map((g) => [g.id, g]));
      if (modifierOptions.some((option) => !assigned.has(option.modifierGroupId))) {
        throw new OrderValidationError("A selected modifier does not belong to this item.");
      }
      for (const group of assigned.values()) {
        const count = modifierOptions.filter((option) => option.modifierGroupId === group.id).length;
        if (count < Math.max(group.minSelections, group.required ? 1 : 0) || count > group.maxSelections) {
          throw new OrderValidationError(`Check the number of selections for "${group.name}".`);
        }
      }

      const modifierAdjustmentTotal = sumRupiah(modifierOptions.map((m) => m.priceAdjustment));
      const unitPrice = basePrice + modifierAdjustmentTotal;
      const lineTotal = unitPrice * line.quantity;

      const consumption: PreparedLine["consumption"] = [];
      let lineCogsPerUnit = 0;

      if (hasRecipe && line.menuItemVariantId) {
        const demand = await calculateLineIngredientDemand(tx, line.menuItemVariantId, line.modifierOptionIds);
        for (const d of demand.values()) {
          const totalQty = d.quantityPerUnit * line.quantity;
          const totalCost = microsToRupiah(multiplyQuantityByRate(totalQty, d.costPerBaseUnit));
          lineCogsPerUnit += microsToRupiah(multiplyQuantityByRate(d.quantityPerUnit, d.costPerBaseUnit));
          consumption.push({ ingredientId: d.ingredientId, quantityBaseUnits: totalQty, unitCostSnapshot: d.costPerBaseUnit, totalCost });

          const existingDemand = totalDemandByIngredient.get(d.ingredientId);
          if (existingDemand) {
            existingDemand.quantity += totalQty;
          } else {
            totalDemandByIngredient.set(d.ingredientId, {
              ingredientName: d.ingredientName,
              baseUnit: d.baseUnit,
              quantity: totalQty,
              costPerBaseUnit: d.costPerBaseUnit,
            });
          }
        }
      }

      const cogsSnapshot = lineCogsPerUnit * line.quantity;

      prepared.push({
        menuItemId: line.menuItemId,
        menuItemVariantId: line.menuItemVariantId ?? null,
        itemNameSnapshot: itemName,
        variantNameSnapshot: variantName,
        quantity: line.quantity,
        unitPriceSnapshot: unitPrice,
        lineTotal,
        notes: line.notes,
        modifiers: modifierOptions.map((m) => ({
          modifierOptionId: m.id,
          name: m.name,
          priceAdjustment: m.priceAdjustment,
          cogsAdjustment: 0,
        })),
        cogsSnapshot,
        grossProfitSnapshot: lineTotal - cogsSnapshot,
        consumption,
      });
    }

    // --- Stock check across the whole order (before writing anything) ------
    if (!business.allowNegativeStock) {
      for (const [ingredientId, need] of totalDemandByIngredient) {
        const locked = await lockIngredientForUpdate(tx, actor.businessId, ingredientId);
        if (Number(locked.currentQuantityBaseUnits) - need.quantity < 0) {
          throw new InsufficientStockError(need.ingredientName, need.quantity - Number(locked.currentQuantityBaseUnits));
        }
      }
    } else {
      // Still lock every distinct ingredient so concurrent orders serialize
      // correctly even when negative stock is allowed.
      for (const ingredientId of totalDemandByIngredient.keys()) {
        await lockIngredientForUpdate(tx, actor.businessId, ingredientId);
      }
    }

    // --- Money totals ---------------------------------------------------------
    const subtotal = sumRupiah(prepared.map((l) => l.lineTotal));
    const discountTotal = Math.min(input.discountTotal, subtotal);
    const netSales = subtotal - discountTotal;
    const taxConfig = parseTaxConfig(business.taxConfig);
    const taxTotal = calculateTax(netSales, taxConfig);
    const serviceChargeTotal = calculateServiceCharge(
      netSales,
      business.serviceChargePercent ? Number(business.serviceChargePercent) : null,
    );
    const total = netSales + taxTotal + serviceChargeTotal;
    const cogsTotal = sumRupiah(prepared.map((l) => l.cogsSnapshot));
    const grossProfit = netSales - cogsTotal;
    const grossMarginPercentage = netSales > 0 ? Math.round((grossProfit / netSales) * 100 * 100) / 100 : null;

    const orderNumber = await generateOrderNumber(tx, actor.businessId, business.orderNumberPrefix);

    const [order] = await tx
      .insert(orders)
      .values({
        businessId: actor.businessId,
        orderNumber,
        status: "SUBMITTED",
        orderType: input.orderType,
        tableLabel: input.tableLabel || null,
        subtotal,
        discountTotal,
        taxTotal,
        serviceChargeTotal,
        total,
        cogsTotal,
        grossProfit,
        grossMarginPercentage: grossMarginPercentage !== null ? String(grossMarginPercentage) : null,
        paymentMethodLabel: input.paymentMethodLabel || null,
        notes: input.notes || null,
        idempotencyKey: input.idempotencyKey,
        createdBy: actor.userId,
      })
      .returning();

    for (const line of prepared) {
      const [orderLine] = await tx
        .insert(orderLines)
        .values({
          orderId: order.id,
          menuItemId: line.menuItemId,
          menuItemVariantId: line.menuItemVariantId,
          itemNameSnapshot: line.itemNameSnapshot,
          variantNameSnapshot: line.variantNameSnapshot,
          quantity: line.quantity,
          unitPriceSnapshot: line.unitPriceSnapshot,
          lineTotal: line.lineTotal,
          cogsSnapshot: line.cogsSnapshot,
          grossProfitSnapshot: line.grossProfitSnapshot,
          notes: line.notes || null,
        })
        .returning();

      if (line.modifiers.length > 0) {
        await tx.insert(orderLineModifiers).values(
          line.modifiers.map((m) => ({
            orderLineId: orderLine.id,
            modifierOptionId: m.modifierOptionId,
            modifierNameSnapshot: m.name,
            priceAdjustmentSnapshot: m.priceAdjustment,
            cogsAdjustmentSnapshot: m.cogsAdjustment,
          })),
        );
      }

      for (const c of line.consumption) {
        const locked = await lockIngredientForUpdate(tx, actor.businessId, c.ingredientId);
        const newQuantity = Number(locked.currentQuantityBaseUnits) - c.quantityBaseUnits;

        const movement = await insertMovementAndApplyStock(
          tx,
          {
            businessId: actor.businessId,
            ingredientId: c.ingredientId,
            movementType: "SALE_CONSUMPTION",
            quantityBaseUnits: -c.quantityBaseUnits,
            unitCost: c.unitCostSnapshot,
            totalCost: c.totalCost,
            sourceType: "order",
            sourceId: order.id,
            createdBy: actor.userId,
          },
          { newQuantityBaseUnits: newQuantity },
        );

        await tx.insert(orderIngredientConsumption).values({
          orderId: order.id,
          orderLineId: orderLine.id,
          ingredientId: c.ingredientId,
          quantityBaseUnits: String(c.quantityBaseUnits),
          unitCostSnapshot: c.unitCostSnapshot,
          totalCost: c.totalCost,
          inventoryMovementId: movement.id,
        });
      }
    }

    // Print job: queued now, actually processed by a provider in Phase 4.
    await tx.insert(printJobs).values({
      orderId: order.id,
      destination: "CUSTOMER_RECEIPT",
      provider: (process.env.PRINT_PROVIDER as "mock" | "browser" | "bridge") || "mock",
      status: "QUEUED",
      payloadSnapshot: buildPrintPayload(order, prepared, business.name),
      requestedBy: actor.userId,
    });

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "order.submitted",
      entityType: "order",
      entityId: order.id,
      after: order,
    });

    return { order, idempotent: false };
  });
}

function buildPrintPayload(
  order: typeof orders.$inferSelect,
  lines: PreparedLine[],
  locationName: string,
) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    locationName,
    createdAt: order.createdAt?.toISOString?.() ?? new Date().toISOString(),
    orderType: order.orderType,
    tableLabel: order.tableLabel ?? undefined,
    lines: lines.map((l) => ({
      name: l.itemNameSnapshot,
      variantName: l.variantNameSnapshot ?? undefined,
      quantity: l.quantity,
      modifiers: l.modifiers.map((m) => m.name),
      note: l.notes,
      unitPrice: l.unitPriceSnapshot,
      lineTotal: l.lineTotal,
    })),
    subtotal: order.subtotal,
    discount: order.discountTotal,
    tax: order.taxTotal,
    total: order.total,
  };
}

export async function getOrderById(db: Database, businessId: string, orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.businessId, businessId)))
    .limit(1);
  if (!order) return null;

  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const lineIds = lines.map((l) => l.id);

  const modifiers =
    lineIds.length > 0
      ? await db.select().from(orderLineModifiers).where(inArray(orderLineModifiers.orderLineId, lineIds))
      : [];

  const consumption = await db
    .select()
    .from(orderIngredientConsumption)
    .where(eq(orderIngredientConsumption.orderId, orderId));

  const prints = await db.select().from(printJobs).where(eq(printJobs.orderId, orderId)).orderBy(desc(printJobs.createdAt));

  return {
    order,
    lines: lines.map((line) => ({
      ...line,
      modifiers: modifiers.filter((m) => m.orderLineId === line.id),
      consumption: consumption.filter((c) => c.orderLineId === line.id),
    })),
    printJobs: prints,
  };
}

export interface ListOrdersFilters {
  status?: string;
  from?: Date;
  to?: Date;
  search?: string;
  createdBy?: string;
  limit?: number;
}

export async function listOrders(db: Database, businessId: string, filters: ListOrdersFilters = {}) {
  const conditions = [eq(orders.businessId, businessId)];
  if (filters.status) conditions.push(eq(orders.status, filters.status as (typeof orders.$inferSelect)["status"]));
  if (filters.createdBy) conditions.push(eq(orders.createdBy, filters.createdBy));
  if (filters.search) conditions.push(sql`${orders.orderNumber} ILIKE ${"%" + filters.search + "%"}`);
  if (filters.from) conditions.push(sql`${orders.createdAt} >= ${filters.from}`);
  if (filters.to) conditions.push(sql`${orders.createdAt} <= ${filters.to}`);

  return db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(filters.limit ?? 100);
}

/**
 * Cancellation reverses every SALE_CONSUMPTION movement the order created
 * (ORDER_CANCELLATION_REVERSAL, linked back to the original movement) and
 * marks the order CANCELLED. Idempotent: cancelling an already-cancelled
 * order is a no-op that returns the order as-is rather than erroring or
 * double-reversing stock.
 */
export async function cancelOrder(
  db: Database,
  actor: ActorContext,
  orderId: string,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.businessId, actor.businessId)))
      .limit(1);
    if (!order) throw new OrderValidationError("Order not found");

    if (order.status === "CANCELLED") {
      return order; // idempotent no-op
    }
    if (order.status === "REFUNDED") {
      throw new OrderValidationError("A refunded order cannot be cancelled.");
    }

    const consumptionRows = await tx
      .select()
      .from(orderIngredientConsumption)
      .where(eq(orderIngredientConsumption.orderId, orderId));

    for (const row of consumptionRows) {
      const locked = await lockIngredientForUpdate(tx, actor.businessId, row.ingredientId);
      const newQuantity = Number(locked.currentQuantityBaseUnits) + Number(row.quantityBaseUnits);

      await insertMovementAndApplyStock(
        tx,
        {
          businessId: actor.businessId,
          ingredientId: row.ingredientId,
          movementType: "ORDER_CANCELLATION_REVERSAL",
          quantityBaseUnits: Number(row.quantityBaseUnits),
          unitCost: row.unitCostSnapshot,
          totalCost: row.totalCost,
          sourceType: "order",
          sourceId: orderId,
          relatedMovementId: row.inventoryMovementId,
          reason: "Order cancellation reversal",
          createdBy: actor.userId,
        },
        { newQuantityBaseUnits: newQuantity },
      );
    }

    const [updated] = await tx
      .update(orders)
      .set({
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: actor.userId,
        cancellationReason: reason,
      })
      .where(eq(orders.id, orderId))
      .returning();

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "order.cancelled",
      entityType: "order",
      entityId: orderId,
      before: order,
      after: updated,
      metadata: { reason },
    });

    return updated;
  });
}

/**
 * Full refund only for the MVP (PRD §6.10). Reverses the same inventory
 * consumption as a cancellation and marks the order REFUNDED; the
 * original order remains in place for audit. Idempotent: refunding an
 * already-refunded order is a no-op.
 */
export async function refundOrder(db: Database, actor: ActorContext, orderId: string, reason: string) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.businessId, actor.businessId)))
      .limit(1);
    if (!order) throw new OrderValidationError("Order not found");

    if (order.status === "REFUNDED") {
      return order; // idempotent no-op
    }
    if (order.status === "CANCELLED") {
      throw new OrderValidationError("A cancelled order cannot be refunded.");
    }

    const consumptionRows = await tx
      .select()
      .from(orderIngredientConsumption)
      .where(eq(orderIngredientConsumption.orderId, orderId));

    for (const row of consumptionRows) {
      const locked = await lockIngredientForUpdate(tx, actor.businessId, row.ingredientId);
      const newQuantity = Number(locked.currentQuantityBaseUnits) + Number(row.quantityBaseUnits);

      await insertMovementAndApplyStock(
        tx,
        {
          businessId: actor.businessId,
          ingredientId: row.ingredientId,
          movementType: "REFUND_REVERSAL",
          quantityBaseUnits: Number(row.quantityBaseUnits),
          unitCost: row.unitCostSnapshot,
          totalCost: row.totalCost,
          sourceType: "order",
          sourceId: orderId,
          relatedMovementId: row.inventoryMovementId,
          reason: "Order refund reversal",
          createdBy: actor.userId,
        },
        { newQuantityBaseUnits: newQuantity },
      );
    }

    const [updated] = await tx
      .update(orders)
      .set({
        status: "REFUNDED",
        refundedAt: new Date(),
        refundedBy: actor.userId,
        refundReason: reason,
      })
      .where(eq(orders.id, orderId))
      .returning();

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "order.refunded",
      entityType: "order",
      entityId: orderId,
      before: order,
      after: updated,
      metadata: { reason },
    });

    return updated;
  });
}
