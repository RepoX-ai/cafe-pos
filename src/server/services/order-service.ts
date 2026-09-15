import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  businesses,
  orderIngredientConsumption,
  orderLineModifiers,
  orderLines,
  orderNumberCounters,
  orders,
  printJobs,
} from "@/lib/db/schema";
import { microsToRupiah, multiplyQuantityByRate, sumRupiah } from "@/lib/money/money";
import { pageWindow, toPage, type Page } from "@/lib/pagination";
import { calculateServiceCharge, calculateTax, parseTaxConfig } from "@/lib/settings/tax";
import { formatQuantityUnits, toQuantityUnits } from "@/lib/units/units";
import { ORDER_LIMITS, type SubmitOrderInput } from "@/lib/validation/order";
import { recordAuditLog } from "./audit";
import { lineDemandPerUnit, loadOrderCatalog, type OrderCatalog } from "./order-consumption";
import {
  insertMovementsAndApplyStock,
  lockIngredientsForUpdate,
  InsufficientStockError,
  type BulkMovementInput,
} from "./inventory-service";
import type { ActorContext } from "./ingredient-service";
import { abandonedPrintClaim } from "./print-service";

export class OrderValidationError extends Error {}

interface PreparedLine {
  id: string;
  menuItemId: string;
  menuItemVariantId: string | null;
  itemNameSnapshot: string;
  variantNameSnapshot: string | null;
  categoryNameSnapshot: string | null;
  quantity: number;
  unitPriceSnapshot: number; // variant price + modifier adjustments
  lineTotal: number;
  notes?: string;
  modifiers: Array<{ modifierOptionId: string; name: string; priceAdjustment: number; cogsAdjustment: number }>;
  cogsSnapshot: number;
  grossProfitSnapshot: number;
  consumption: Array<{
    movementId: string;
    ingredientId: string;
    ingredientName: string;
    baseUnit: "gram" | "millilitre" | "piece";
    quantityUnits: bigint; // total for this line (per-unit x quantity)
    unitCostSnapshot: string;
    totalCost: number;
  }>;
}

/** Walks drizzle's DrizzleQueryError -> pg error chain; the constraint name is only on the pg error. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = error as { code?: string; constraint?: string; cause?: unknown } | undefined; current; current = current.cause as typeof current) {
    if (current.code === "23505" && current.constraint === constraint) return true;
  }
  return false;
}

export async function findOrderByIdempotencyKey(db: Database, businessId: string, idempotencyKey: string) {
  const [existing] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.businessId, businessId), eq(orders.idempotencyKey, idempotencyKey)))
    .limit(1);
  return existing ?? null;
}

/**
 * Next order number for the business. The counter row is created on first
 * use from the existing order count, so numbering continues the documented
 * `PREFIX-00001` sequence (count + 1) for businesses that already have
 * orders. `resync` re-aligns a counter that fell behind existing numbers
 * (only attempted after an order-number collision).
 */
async function allocateOrderNumber(tx: Database, businessId: string, resync: boolean): Promise<number> {
  if (resync) {
    await tx.execute(sql`
      update order_number_counters
      set last_number = greatest(last_number, (select count(*)::int from orders where business_id = ${businessId}))
      where business_id = ${businessId}
    `);
  }
  const [updated] = await tx
    .update(orderNumberCounters)
    .set({ lastNumber: sql`${orderNumberCounters.lastNumber} + 1`, updatedAt: new Date() })
    .where(eq(orderNumberCounters.businessId, businessId))
    .returning({ lastNumber: orderNumberCounters.lastNumber });
  if (updated) return updated.lastNumber;

  const [inserted] = await tx
    .insert(orderNumberCounters)
    .values({
      businessId,
      lastNumber: sql`(select count(*)::int + 1 from orders where business_id = ${businessId})`,
    })
    .onConflictDoUpdate({
      target: orderNumberCounters.businessId,
      set: { lastNumber: sql`${orderNumberCounters.lastNumber} + 1`, updatedAt: new Date() },
    })
    .returning({ lastNumber: orderNumberCounters.lastNumber });
  return inserted.lastNumber;
}

/**
 * The order-submission transaction (PRD §6.9, §8). Runs entirely inside one
 * DB transaction: idempotency check, menu/recipe/stock revalidation,
 * snapshotting, ingredient consumption + inventory movements, COGS/profit
 * calculation, a queued print job, and an audit log — or nothing at all if
 * any step fails.
 *
 * Serialization: submissions that share an ingredient serialize on those
 * ingredient row locks (taken in id order); every submission for a business
 * serializes on its order-number counter row, but only from number
 * allocation — after validation, costing and the stock check — to commit.
 * A concurrent retry of the same idempotency key loses on the unique index
 * and returns the winner's order, with its own work rolled back.
 */
export async function submitOrder(
  db: Database,
  actor: ActorContext,
  input: SubmitOrderInput,
): Promise<{ order: typeof orders.$inferSelect; idempotent: boolean }> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptSubmitOrder(db, actor, input, attempt > 0);
    } catch (error) {
      if (isUniqueViolation(error, "orders_business_idempotency_key_idx")) {
        const existing = await findOrderByIdempotencyKey(db, actor.businessId, input.idempotencyKey);
        if (existing) return { order: existing, idempotent: true };
      }
      if (isUniqueViolation(error, "orders_business_order_number_idx")) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not generate a unique order number");
}

function validateLine(catalog: OrderCatalog, line: SubmitOrderInput["lines"][number]) {
  // Two pricing paths: a selected variant (the normal case), or — when
  // the item has no variants at all — the item's own base price. An item
  // sold the second way has no recipe row to deduct stock or compute COGS
  // from, so it never affects inventory/COGS regardless of tracksInventory.
  let itemName: string;
  let variantName: string | null = null;
  let categoryName: string | null = null;
  let basePrice: number;
  let hasRecipe = false;

  if (line.menuItemVariantId) {
    const variant = catalog.variants.get(line.menuItemVariantId);
    if (!variant || variant.menuItemId !== line.menuItemId) {
      throw new OrderValidationError("A menu item in this order no longer exists.");
    }
    if (!variant.menuItemActive || !variant.variantActive) {
      throw new OrderValidationError(`"${variant.menuItemName}" is not currently available.`);
    }
    itemName = variant.menuItemName;
    variantName = variant.variantName;
    categoryName = variant.categoryName;
    basePrice = variant.variantPrice;
    hasRecipe = variant.tracksInventory;
  } else {
    const item = catalog.baseItems.get(line.menuItemId);
    if (item && item.variantCount > 0) {
      throw new OrderValidationError("Choose an available variant for this item.");
    }
    if (!item) {
      throw new OrderValidationError("A menu item in this order no longer exists.");
    }
    if (!item.menuItemActive) {
      throw new OrderValidationError(`"${item.menuItemName}" is not currently available.`);
    }
    itemName = item.menuItemName;
    categoryName = item.categoryName;
    basePrice = item.basePrice;
  }

  const selectedOptions = line.modifierOptionIds.flatMap((id) => {
    const option = catalog.options.get(id);
    return option ? [option] : [];
  });
  if (selectedOptions.length !== line.modifierOptionIds.length || new Set(line.modifierOptionIds).size !== line.modifierOptionIds.length) {
    throw new OrderValidationError("One or more selected modifiers are no longer available.");
  }
  const inactiveModifier = selectedOptions.find((m) => !m.active);
  if (inactiveModifier) {
    throw new OrderValidationError(`"${inactiveModifier.name}" is no longer available.`);
  }

  const assigned = new Map((catalog.groupsByItem.get(line.menuItemId) ?? []).filter((g) => g.active).map((g) => [g.id, g]));
  if (selectedOptions.some((option) => !assigned.has(option.modifierGroupId))) {
    throw new OrderValidationError("A selected modifier does not belong to this item.");
  }
  for (const group of assigned.values()) {
    const count = selectedOptions.filter((option) => option.modifierGroupId === group.id).length;
    if (count < Math.max(group.minSelections, group.required ? 1 : 0) || count > group.maxSelections) {
      throw new OrderValidationError(`Check the number of selections for "${group.name}".`);
    }
  }

  const unitPrice = basePrice + sumRupiah(selectedOptions.map((m) => m.priceAdjustment));
  return {
    line,
    itemName,
    variantName,
    categoryName,
    unitPrice,
    lineTotal: unitPrice * line.quantity,
    selectedOptions,
    demandPerUnit:
      hasRecipe && line.menuItemVariantId
        ? lineDemandPerUnit(catalog, line.menuItemVariantId, line.modifierOptionIds)
        : new Map<string, number>(),
  };
}

async function attemptSubmitOrder(db: Database, actor: ActorContext, input: SubmitOrderInput, resyncCounter: boolean) {
  return db.transaction(async (tx) => {
    const existing = await findOrderByIdempotencyKey(tx, actor.businessId, input.idempotencyKey);
    if (existing) {
      return { order: existing, idempotent: true };
    }

    const [business] = await tx.select().from(businesses).where(eq(businesses.id, actor.businessId)).limit(1);
    if (!business) throw new OrderValidationError("Business not found");

    // --- Validate and price every line from one batched catalog read ---------
    const catalog = await loadOrderCatalog(tx, actor.businessId, input.lines);
    const validated = input.lines.map((line) => validateLine(catalog, line));

    // --- Lock every consumed ingredient, then cost from the locked rows -------
    const locked = await lockIngredientsForUpdate(
      tx,
      actor.businessId,
      validated.flatMap((line) => [...line.demandPerUnit.keys()]),
    );

    const needByIngredient = new Map<string, bigint>();
    const prepared: PreparedLine[] = validated.map((v) => {
      const consumption: PreparedLine["consumption"] = [];
      let lineCogsPerUnit = 0;
      for (const [ingredientId, quantityPerUnit] of v.demandPerUnit) {
        const ingredient = locked.get(ingredientId)!;
        const totalQuantity = quantityPerUnit * v.line.quantity;
        const quantityUnits = toQuantityUnits(totalQuantity);
        lineCogsPerUnit += microsToRupiah(multiplyQuantityByRate(quantityPerUnit, ingredient.averageCostPerBaseUnit));
        consumption.push({
          movementId: randomUUID(),
          ingredientId,
          ingredientName: ingredient.name,
          baseUnit: ingredient.baseUnit,
          quantityUnits,
          unitCostSnapshot: ingredient.averageCostPerBaseUnit,
          totalCost: microsToRupiah(multiplyQuantityByRate(totalQuantity, ingredient.averageCostPerBaseUnit)),
        });
        needByIngredient.set(ingredientId, (needByIngredient.get(ingredientId) ?? 0n) + quantityUnits);
      }
      const cogsSnapshot = lineCogsPerUnit * v.line.quantity;
      return {
        id: randomUUID(),
        menuItemId: v.line.menuItemId,
        menuItemVariantId: v.line.menuItemVariantId ?? null,
        itemNameSnapshot: v.itemName,
        variantNameSnapshot: v.variantName,
        categoryNameSnapshot: v.categoryName,
        quantity: v.line.quantity,
        unitPriceSnapshot: v.unitPrice,
        lineTotal: v.lineTotal,
        notes: v.line.notes,
        modifiers: v.selectedOptions.map((m) => ({
          modifierOptionId: m.id,
          name: m.name,
          priceAdjustment: m.priceAdjustment,
          cogsAdjustment: 0,
        })),
        cogsSnapshot,
        grossProfitSnapshot: v.lineTotal - cogsSnapshot,
        consumption,
      };
    });

    // --- Stock check across the whole order (before writing anything) ------
    if (!business.allowNegativeStock) {
      for (const [ingredientId, need] of needByIngredient) {
        const ingredient = locked.get(ingredientId)!;
        const available = toQuantityUnits(ingredient.currentQuantityBaseUnits);
        if (available - need < 0n) {
          throw new InsufficientStockError(ingredient.name, Number(formatQuantityUnits(need - available)));
        }
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

    if ([subtotal, total, cogsTotal, ...prepared.map((l) => l.cogsSnapshot)].some((amount) => amount > ORDER_LIMITS.maxRupiah)) {
      throw new OrderValidationError("This order is too large to record. Split it into smaller orders.");
    }

    const orderNumber = `${business.orderNumberPrefix}-${String(await allocateOrderNumber(tx, actor.businessId, resyncCounter)).padStart(5, "0")}`;

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

    await tx.insert(orderLines).values(
      prepared.map((line) => ({
        id: line.id,
        orderId: order.id,
        menuItemId: line.menuItemId,
        menuItemVariantId: line.menuItemVariantId,
        itemNameSnapshot: line.itemNameSnapshot,
        variantNameSnapshot: line.variantNameSnapshot,
        categoryNameSnapshot: line.categoryNameSnapshot,
        quantity: line.quantity,
        unitPriceSnapshot: line.unitPriceSnapshot,
        lineTotal: line.lineTotal,
        cogsSnapshot: line.cogsSnapshot,
        grossProfitSnapshot: line.grossProfitSnapshot,
        notes: line.notes || null,
      })),
    );

    const modifierRows = prepared.flatMap((line) =>
      line.modifiers.map((m) => ({
        orderLineId: line.id,
        modifierOptionId: m.modifierOptionId,
        modifierNameSnapshot: m.name,
        priceAdjustmentSnapshot: m.priceAdjustment,
        cogsAdjustmentSnapshot: m.cogsAdjustment,
      })),
    );
    if (modifierRows.length > 0) await tx.insert(orderLineModifiers).values(modifierRows);

    const consumption = prepared.flatMap((line) => line.consumption.map((c) => ({ line, c })));
    await insertMovementsAndApplyStock(
      tx,
      consumption.map(({ c }): BulkMovementInput => ({
        id: c.movementId,
        businessId: actor.businessId,
        ingredientId: c.ingredientId,
        movementType: "SALE_CONSUMPTION",
        quantityUnits: -c.quantityUnits,
        unitCost: c.unitCostSnapshot,
        totalCost: c.totalCost,
        sourceType: "order",
        sourceId: order.id,
        createdBy: actor.userId,
      })),
      locked,
    );
    if (consumption.length > 0) {
      await tx.insert(orderIngredientConsumption).values(
        consumption.map(({ line, c }) => ({
          orderId: order.id,
          orderLineId: line.id,
          ingredientId: c.ingredientId,
          ingredientNameSnapshot: c.ingredientName,
          ingredientBaseUnitSnapshot: c.baseUnit,
          quantityBaseUnits: formatQuantityUnits(c.quantityUnits),
          unitCostSnapshot: c.unitCostSnapshot,
          totalCost: c.totalCost,
          inventoryMovementId: c.movementId,
        })),
      );
    }

    // Print job: queued now, processed by a provider after commit.
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

  // outcomeUnknown: still PROCESSING past its lease, so it may or may not have printed.
  const prints = await db
    .select({ ...getTableColumns(printJobs), outcomeUnknown: sql<boolean>`coalesce(${abandonedPrintClaim()}, false)` })
    .from(printJobs)
    .where(eq(printJobs.orderId, orderId))
    .orderBy(desc(printJobs.createdAt));

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
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface OrderItemSummary {
  name: string;
  quantity: number;
}

/**
 * Item names for a list of orders, fetched in one query rather than one
 * per row. Reads the order-line snapshots, never the current menu, so a
 * renamed or deleted menu item still lists the way it was sold.
 */
export async function listOrderItemSummaries(
  db: Database,
  orderIds: string[],
): Promise<Map<string, OrderItemSummary[]>> {
  const byOrder = new Map<string, OrderItemSummary[]>();
  if (orderIds.length === 0) return byOrder;

  const rows = await db
    .select({
      orderId: orderLines.orderId,
      itemName: orderLines.itemNameSnapshot,
      variantName: orderLines.variantNameSnapshot,
      quantity: orderLines.quantity,
    })
    .from(orderLines)
    .where(inArray(orderLines.orderId, orderIds))
    // order_lines has no position column, so sort by name to keep the
    // summary stable between renders instead of whatever order the
    // planner returns.
    .orderBy(orderLines.itemNameSnapshot);

  for (const row of rows) {
    const name = row.variantName ? `${row.itemName} (${row.variantName})` : row.itemName;
    const list = byOrder.get(row.orderId);
    if (list) list.push({ name, quantity: row.quantity });
    else byOrder.set(row.orderId, [{ name, quantity: row.quantity }]);
  }

  return byOrder;
}

/** One page of orders, newest first (id breaks ties so pages never overlap). */
export async function listOrders(
  db: Database,
  businessId: string,
  filters: ListOrdersFilters = {},
): Promise<Page<typeof orders.$inferSelect>> {
  const { page, pageSize, limit, offset } = pageWindow(filters.page, filters.pageSize);
  const conditions = [eq(orders.businessId, businessId)];
  if (filters.status) conditions.push(eq(orders.status, filters.status as (typeof orders.$inferSelect)["status"]));
  if (filters.search) conditions.push(sql`${orders.orderNumber} ILIKE ${"%" + filters.search + "%"}`);

  const rows = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, page, pageSize);
}

const REVERSALS = {
  cancel: {
    status: "CANCELLED",
    conflictingStatus: "REFUNDED",
    conflictMessage: "A refunded order cannot be cancelled.",
    movementType: "ORDER_CANCELLATION_REVERSAL",
    reason: "Order cancellation reversal",
    auditAction: "order.cancelled",
  },
  refund: {
    status: "REFUNDED",
    conflictingStatus: "CANCELLED",
    conflictMessage: "A cancelled order cannot be refunded.",
    movementType: "REFUND_REVERSAL",
    reason: "Order refund reversal",
    auditAction: "order.refunded",
  },
} as const;

/**
 * Cancellation and refund both reverse every SALE_CONSUMPTION movement the
 * order created (linked back via relatedMovementId) and change the order's
 * status, in one transaction (PRD §8 "Cancellation transaction": lock the
 * order, verify it is cancellable, reverse, update status, audit).
 *
 * The order row is locked FOR UPDATE before its status is read, so racing
 * requests queue behind each other: the first reverses stock, and every
 * later one sees the final status — a repeat of the same action is an
 * idempotent no-op, and the other action is refused.
 */
async function reverseOrder(
  db: Database,
  actor: ActorContext,
  orderId: string,
  reason: string,
  kind: keyof typeof REVERSALS,
) {
  const config = REVERSALS[kind];
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.businessId, actor.businessId)))
      .for("update");
    if (!order) throw new OrderValidationError("Order not found");

    if (order.status === config.status) {
      return order; // idempotent no-op
    }
    if (order.status === config.conflictingStatus) {
      throw new OrderValidationError(config.conflictMessage);
    }

    // The ingredient may have been deleted since the order was placed. Its
    // consumption row stays for the audit trail, but there is no stock left
    // to hand back, so it is skipped.
    const consumptionRows = (
      await tx.select().from(orderIngredientConsumption).where(eq(orderIngredientConsumption.orderId, orderId))
    ).filter((row): row is typeof row & { ingredientId: string } => row.ingredientId !== null);

    const locked = await lockIngredientsForUpdate(tx, actor.businessId, consumptionRows.map((row) => row.ingredientId));
    await insertMovementsAndApplyStock(
      tx,
      consumptionRows.map((row) => ({
        id: randomUUID(),
        businessId: actor.businessId,
        ingredientId: row.ingredientId,
        movementType: config.movementType,
        quantityUnits: toQuantityUnits(row.quantityBaseUnits),
        unitCost: row.unitCostSnapshot,
        totalCost: row.totalCost,
        sourceType: "order",
        sourceId: orderId,
        relatedMovementId: row.inventoryMovementId,
        reason: config.reason,
        createdBy: actor.userId,
      })),
      locked,
    );

    const now = new Date();
    const [updated] = await tx
      .update(orders)
      .set(
        kind === "cancel"
          ? { status: "CANCELLED", cancelledAt: now, cancelledBy: actor.userId, cancellationReason: reason }
          : { status: "REFUNDED", refundedAt: now, refundedBy: actor.userId, refundReason: reason },
      )
      .where(and(eq(orders.id, orderId), eq(orders.businessId, actor.businessId)))
      .returning();

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: config.auditAction,
      entityType: "order",
      entityId: orderId,
      before: order,
      after: updated,
      metadata: { reason },
    });

    return updated;
  });
}

/** Cancels an order and reverses its stock consumption. Idempotent; refused for refunded orders. */
export function cancelOrder(db: Database, actor: ActorContext, orderId: string, reason: string) {
  return reverseOrder(db, actor, orderId, reason, "cancel");
}

/**
 * Full refund only for the MVP (PRD §6.10). Reverses the same inventory
 * consumption as a cancellation; the original order remains for audit.
 * Idempotent; refused for cancelled orders.
 */
export function refundOrder(db: Database, actor: ActorContext, orderId: string, reason: string) {
  return reverseOrder(db, actor, orderId, reason, "refund");
}
