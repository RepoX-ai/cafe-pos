import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import {
  ingredients,
  inventoryMovements,
  orderIngredientConsumption,
  orderLineModifiers,
  orderLines,
  orders,
  purchases,
  suppliers,
} from "@/lib/db/schema";
import { formatQuantityUnits, toQuantityUnits } from "@/lib/units/units";
import type { BusinessDateRange } from "@/lib/dates/dates";
import { recordAuditLog } from "./audit";
import { withinBusinessDays } from "./range-filters";
import type { ActorContext } from "./ingredient-service";

export class InsufficientStockError extends Error {
  constructor(
    public ingredientName: string,
    public shortfallBaseUnits: number,
  ) {
    super(`Insufficient stock for "${ingredientName}" (short by ${shortfallBaseUnits}).`);
    this.name = "InsufficientStockError";
  }
}

type MovementType = (typeof inventoryMovements.movementType.enumValues)[number];

export type LockedIngredient = typeof ingredients.$inferSelect;

/**
 * Locks the ingredient rows for the remainder of the transaction (`SELECT
 * ... FOR UPDATE`) so two concurrent movements against the same ingredient
 * can't both read the same starting quantity and silently lose one update
 * (PRD §8: "Lock or safely re-read relevant ingredient rows"). Always in
 * ingredient-id order: every multi-ingredient flow (checkout, reversals,
 * purchases, stock counts) takes its locks through here, so two
 * transactions can never hold them in opposite orders and deadlock.
 * Lock order across flows: order row -> ingredient rows (by id) -> order-number counter.
 * Must be called inside `db.transaction(...)`.
 */
export async function lockIngredientsForUpdate(
  tx: Database,
  businessId: string,
  ingredientIds: Iterable<string>,
): Promise<Map<string, LockedIngredient>> {
  const ids = [...new Set(ingredientIds)];
  const locked = new Map<string, LockedIngredient>();
  if (ids.length === 0) return locked;
  const rows = await tx
    .select()
    .from(ingredients)
    .where(and(inArray(ingredients.id, ids), eq(ingredients.businessId, businessId)))
    .orderBy(asc(ingredients.id))
    .for("update");
  for (const row of rows) locked.set(row.id, row);
  if (locked.size !== ids.length) throw new Error("Ingredient not found");
  return locked;
}

export interface MovementInput {
  id: string;
  businessId: string;
  locationId?: string | null;
  ingredientId: string;
  movementType: MovementType;
  /** Signed ten-thousandths of a base unit (see `toQuantityUnits`): positive = inbound, negative = outbound. */
  quantityUnits: bigint;
  unitCost?: string | null;
  totalCost?: number | null;
  sourceType: string;
  sourceId?: string | null;
  relatedMovementId?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

/**
 * The one way stock changes: one INSERT for every ledger row and one
 * UPDATE for every touched ingredient's cached quantity (and, for
 * purchases, its new average cost). Every ingredient must already be
 * locked via `lockIngredientsForUpdate`; the new quantity is the locked
 * quantity plus the exact sum of its movements. Each ledger row snapshots
 * the ingredient's name and unit so it still reads correctly if the
 * ingredient is deleted later (the FK then goes NULL).
 */
export async function insertMovementsAndApplyStock(
  tx: Database,
  movements: MovementInput[],
  locked: Map<string, LockedIngredient>,
  opts: { averageCostPerBaseUnit?: Map<string, string> } = {},
): Promise<Map<string, bigint>> {
  const nextQuantity = new Map<string, bigint>();
  if (movements.length === 0) return nextQuantity;

  for (const movement of movements) {
    const ingredient = locked.get(movement.ingredientId);
    if (!ingredient) throw new Error("Ingredient must be locked before its stock changes");
    const current = nextQuantity.get(movement.ingredientId) ?? toQuantityUnits(ingredient.currentQuantityBaseUnits);
    nextQuantity.set(movement.ingredientId, current + movement.quantityUnits);
  }

  await tx.insert(inventoryMovements).values(
    movements.map((movement) => {
      const ingredient = locked.get(movement.ingredientId)!;
      return {
        id: movement.id,
        businessId: movement.businessId,
        locationId: movement.locationId ?? null,
        ingredientId: movement.ingredientId,
        ingredientNameSnapshot: ingredient.name,
        ingredientBaseUnitSnapshot: ingredient.baseUnit,
        movementType: movement.movementType,
        quantityBaseUnits: formatQuantityUnits(movement.quantityUnits),
        unitCost: movement.unitCost ?? null,
        totalCost: movement.totalCost ?? null,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId ?? null,
        relatedMovementId: movement.relatedMovementId ?? null,
        reason: movement.reason ?? null,
        notes: movement.notes ?? null,
        createdBy: movement.createdBy ?? null,
      };
    }),
  );

  const values = sql.join(
    [...nextQuantity].map(
      ([id, quantity]) =>
        sql`(${id}::uuid, ${formatQuantityUnits(quantity)}::numeric, ${opts.averageCostPerBaseUnit?.get(id) ?? null}::numeric)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    update ingredients
    set current_quantity_base_units = v.quantity,
        average_cost_per_base_unit = coalesce(v.average_cost, ingredients.average_cost_per_base_unit),
        updated_at = now()
    from (values ${values}) as v(id, quantity, average_cost)
    where ingredients.id = v.id
  `);

  return nextQuantity;
}

export interface ManualAdjustmentInput {
  ingredientId: string;
  direction: "in" | "out";
  quantityBaseUnits: number; // always positive; direction determines sign
  reason: string;
  notes?: string;
}

/**
 * Manual stock adjustments (PRD movement types MANUAL_ADJUSTMENT_IN /
 * MANUAL_ADJUSTMENT_OUT) — for corrections outside the purchase, waste, or
 * stock-count flows. Every adjustment requires a reason and is audited in
 * the same transaction.
 */
export async function createManualAdjustment(
  db: Database,
  actor: ActorContext,
  input: ManualAdjustmentInput,
  opts: { allowNegativeStock: boolean },
) {
  return db.transaction(async (tx) => {
    const locked = await lockIngredientsForUpdate(tx, actor.businessId, [input.ingredientId]);
    const ingredient = locked.get(input.ingredientId)!;
    const units = toQuantityUnits(input.quantityBaseUnits);
    const quantityUnits = input.direction === "in" ? units : -units;

    const remaining = toQuantityUnits(ingredient.currentQuantityBaseUnits) + quantityUnits;
    if (remaining < 0n && !opts.allowNegativeStock) {
      throw new InsufficientStockError(ingredient.name, Number(formatQuantityUnits(-remaining)));
    }

    const movementId = randomUUID();
    await insertMovementsAndApplyStock(
      tx,
      [
        {
          id: movementId,
          businessId: actor.businessId,
          ingredientId: input.ingredientId,
          movementType: input.direction === "in" ? "MANUAL_ADJUSTMENT_IN" : "MANUAL_ADJUSTMENT_OUT",
          quantityUnits,
          sourceType: "manual_adjustment",
          reason: input.reason,
          notes: input.notes ?? null,
          createdBy: actor.userId,
        },
      ],
      locked,
    );

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "inventory.manual_adjustment",
      entityType: "inventory_movement",
      entityId: movementId,
      metadata: input,
    });

    return { id: movementId };
  });
}

/** Ledger rows, newest first; `range` filters on created_at by Jakarta business day. */
function movementFilter(businessId: string, opts: { ingredientId?: string; range?: BusinessDateRange }) {
  const conditions = [eq(inventoryMovements.businessId, businessId)];
  if (opts.ingredientId) conditions.push(eq(inventoryMovements.ingredientId, opts.ingredientId));
  if (opts.range) conditions.push(withinBusinessDays(inventoryMovements.createdAt, opts.range));
  return and(...conditions);
}

export async function countMovements(db: Database, businessId: string, opts: { ingredientId?: string; range?: BusinessDateRange } = {}) {
  return db.$count(inventoryMovements, movementFilter(businessId, opts));
}

export async function listMovements(
  db: Database,
  businessId: string,
  opts: { ingredientId?: string; range?: BusinessDateRange; limit?: number; offset?: number } = {},
) {

  return db
    .select({
      id: inventoryMovements.id,
      ingredientId: inventoryMovements.ingredientId,
      // Prefer the live ingredient, fall back to what the row recorded —
      // the fallback is what a deleted ingredient's movements read as.
      ingredientName: sql<string>`coalesce(${ingredients.name}, ${inventoryMovements.ingredientNameSnapshot}, 'Deleted ingredient')`,
      baseUnit: sql<"gram" | "millilitre" | "piece">`coalesce(${ingredients.baseUnit}, ${inventoryMovements.ingredientBaseUnitSnapshot}, 'gram')`,
      // Null for a deleted ingredient; the UI then falls back to the base unit.
      displayUnit: ingredients.displayUnit,
      movementType: inventoryMovements.movementType,
      quantityBaseUnits: inventoryMovements.quantityBaseUnits,
      unitCost: inventoryMovements.unitCost,
      totalCost: inventoryMovements.totalCost,
      sourceType: inventoryMovements.sourceType,
      sourceId: inventoryMovements.sourceId,
      relatedMovementId: inventoryMovements.relatedMovementId,
      reason: inventoryMovements.reason,
      notes: inventoryMovements.notes,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .leftJoin(ingredients, eq(inventoryMovements.ingredientId, ingredients.id))
    .where(movementFilter(businessId, opts))
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(opts.limit ?? 200)
    .offset(opts.offset ?? 0);
}

export interface MovementSource {
  /** What caused the movement, e.g. "Enoki (Large) ×2 + Egg" or a supplier name. */
  label: string;
  /** Order number or invoice number, when there is one. */
  reference: string | null;
  kind: "order" | "purchase";
  sourceId: string;
}

/**
 * Human-readable origin for a page of ledger rows, batched rather than per
 * row. Sale movements are one per order line and ingredient, so each maps
 * back to exactly one line; a cancellation/refund reversal points at the
 * sale it undoes through `relatedMovementId`. Read from order snapshots, so
 * a renamed or deleted menu item still shows as it was sold.
 */
export async function describeMovementSources(
  db: Database,
  businessId: string,
  movements: Array<{ id: string; sourceType: string; sourceId: string | null; relatedMovementId: string | null }>,
): Promise<Map<string, MovementSource>> {
  const result = new Map<string, MovementSource>();

  const saleMovementIdFor = new Map<string, string>();
  for (const m of movements) {
    if (m.sourceType === "order") saleMovementIdFor.set(m.id, m.relatedMovementId ?? m.id);
  }
  const purchaseIds = [...new Set(movements.filter((m) => m.sourceType === "purchase" && m.sourceId).map((m) => m.sourceId!))];

  const [lineRows, purchaseRows] = await Promise.all([
    saleMovementIdFor.size
      ? db
          .select({
            movementId: orderIngredientConsumption.inventoryMovementId,
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            orderLineId: orderLines.id,
            itemName: orderLines.itemNameSnapshot,
            variantName: orderLines.variantNameSnapshot,
            quantity: orderLines.quantity,
          })
          .from(orderIngredientConsumption)
          .innerJoin(orderLines, eq(orderIngredientConsumption.orderLineId, orderLines.id))
          .innerJoin(orders, eq(orderIngredientConsumption.orderId, orders.id))
          .where(
            and(
              eq(orders.businessId, businessId),
              inArray(orderIngredientConsumption.inventoryMovementId, [...new Set(saleMovementIdFor.values())]),
            ),
          )
      : [],
    purchaseIds.length
      ? db
          .select({ id: purchases.id, invoiceNumber: purchases.invoiceNumber, supplierName: suppliers.name })
          .from(purchases)
          .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
          .where(and(eq(purchases.businessId, businessId), inArray(purchases.id, purchaseIds)))
      : [],
  ]);

  const modifierRows = lineRows.length
    ? await db
        .select({ orderLineId: orderLineModifiers.orderLineId, name: orderLineModifiers.modifierNameSnapshot })
        .from(orderLineModifiers)
        .where(inArray(orderLineModifiers.orderLineId, [...new Set(lineRows.map((r) => r.orderLineId))]))
    : [];
  const modifiersByLine = new Map<string, string[]>();
  for (const row of modifierRows) {
    modifiersByLine.set(row.orderLineId, [...(modifiersByLine.get(row.orderLineId) ?? []), row.name]);
  }

  const lineBySaleMovement = new Map(lineRows.map((r) => [r.movementId, r]));
  const purchaseById = new Map(purchaseRows.map((r) => [r.id, r]));

  for (const m of movements) {
    if (m.sourceType === "order") {
      const line = lineBySaleMovement.get(saleMovementIdFor.get(m.id)!);
      if (!line) continue;
      const item = line.variantName ? `${line.itemName} (${line.variantName})` : line.itemName;
      const qty = line.quantity > 1 ? ` ×${line.quantity}` : "";
      const modifiers = modifiersByLine.get(line.orderLineId) ?? [];
      result.set(m.id, {
        kind: "order",
        sourceId: line.orderId,
        label: [`${item}${qty}`, ...modifiers].join(" + "),
        reference: line.orderNumber,
      });
    } else if (m.sourceType === "purchase" && m.sourceId) {
      const purchase = purchaseById.get(m.sourceId);
      if (!purchase) continue;
      result.set(m.id, {
        kind: "purchase",
        sourceId: purchase.id,
        label: purchase.supplierName ?? "Purchase",
        reference: purchase.invoiceNumber,
      });
    }
  }
  return result;
}
