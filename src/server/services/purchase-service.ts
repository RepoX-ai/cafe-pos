import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ingredients, purchaseLines, purchases, suppliers } from "@/lib/db/schema";
import { convertToBaseUnits, toQuantityUnits } from "@/lib/units/units";
import { microsToRupiah, multiplyQuantityByRate } from "@/lib/money/money";
import { calculateWeightedAverageCost } from "@/lib/purchasing/weighted-average-cost";
import type { PurchaseInput } from "@/lib/validation/purchase";
import type { BusinessDateRange } from "@/lib/dates/dates";
import { countUpTo, withinCalendarDates } from "./range-filters";
import { afterTimeCursor, cursorText, type TimeCursor } from "./keyset";
import { recordAuditLog } from "./audit";
import { NotFoundError, ServiceError } from "./errors";
import { BOUNDS } from "@/lib/validation/bounds";
import { insertMovementsAndApplyStock, lockIngredientsForUpdate, type MovementInput } from "./inventory-service";
import type { ActorContext } from "./ingredient-service";
import { runIdempotent } from "./request-idempotency";

/** Newest receipts first; `range` filters on the date-only purchase_date. */
function purchaseFilter(businessId: string, range?: BusinessDateRange, after?: TimeCursor) {
  const conditions = [eq(purchases.businessId, businessId)];
  if (range) conditions.push(withinCalendarDates(purchases.purchaseDate, range));
  if (after) conditions.push(afterTimeCursor(purchases.createdAt, purchases.id, after));
  return and(...conditions);
}

export async function countPurchases(db: Database, businessId: string, opts: { range?: BusinessDateRange; cap?: number } = {}) {
  return countUpTo(db, purchases, purchaseFilter(businessId, opts.range), opts.cap);
}

export async function listPurchases(
  db: Database,
  businessId: string,
  opts: { range?: BusinessDateRange; limit: number; offset?: number; after?: TimeCursor },
) {
  return db
    .select({
      id: purchases.id,
      invoiceNumber: purchases.invoiceNumber,
      purchaseDate: purchases.purchaseDate,
      status: purchases.status,
      totalCost: purchases.totalCost,
      createdAt: purchases.createdAt,
      cursorTs: cursorText(purchases.createdAt),
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, and(eq(purchases.supplierId, suppliers.id), eq(suppliers.businessId, purchases.businessId)))
    .where(purchaseFilter(businessId, opts.range, opts.after))
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .limit(opts.limit)
    .offset(opts.offset ?? 0);
}

export async function getPurchaseWithLines(db: Database, businessId: string, id: string) {
  const [purchase] = await db
    .select({
      id: purchases.id,
      invoiceNumber: purchases.invoiceNumber,
      purchaseDate: purchases.purchaseDate,
      status: purchases.status,
      totalCost: purchases.totalCost,
      createdAt: purchases.createdAt,
      finalizedAt: purchases.finalizedAt,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, and(eq(purchases.supplierId, suppliers.id), eq(suppliers.businessId, purchases.businessId)))
    .where(and(eq(purchases.id, id), eq(purchases.businessId, businessId)))
    .limit(1);
  if (!purchase) return null;

  const lines = await db
    .select({
      id: purchaseLines.id,
      ingredientId: purchaseLines.ingredientId,
      ingredientName: sql<string>`coalesce(${ingredients.name}, ${purchaseLines.ingredientNameSnapshot}, 'Deleted ingredient')`,
      ingredientBaseUnit: sql<"gram" | "millilitre" | "piece">`coalesce(${ingredients.baseUnit}, ${purchaseLines.ingredientBaseUnitSnapshot}, 'gram')`,
      quantityPurchased: purchaseLines.quantityPurchased,
      purchaseUnit: purchaseLines.purchaseUnit,
      conversionToBaseUnits: purchaseLines.conversionToBaseUnits,
      quantityBaseUnits: purchaseLines.quantityBaseUnits,
      totalLineCost: purchaseLines.totalLineCost,
      costPerBaseUnit: purchaseLines.costPerBaseUnit,
    })
    .from(purchaseLines)
    .leftJoin(ingredients, and(eq(purchaseLines.ingredientId, ingredients.id), eq(ingredients.businessId, businessId)))
    .where(eq(purchaseLines.purchaseId, id));

  return { purchase, lines };
}

/**
 * Creates and immediately finalizes a purchase receipt in one transaction:
 * increases stock, recomputes each ingredient's weighted average cost, and
 * writes a PURCHASE_RECEIPT movement per line (PRD §6.7). The `status`/
 * `finalizedAt` columns exist so a future draft-then-finalize workflow can
 * be layered on without a schema change, but the MVP only ever creates
 * receipts pre-finalized — once finalized, a purchase is immutable; fix
 * mistakes with a new reversing entry, not an edit.
 *
 * Every ingredient lock is taken up front, in id order, like checkout and
 * order reversals do; the lines, the ledger rows and the ingredient
 * updates are then written as one batch each rather than per line.
 */
export async function createAndFinalizePurchase(
  db: Database,
  actor: ActorContext,
  input: PurchaseInput & { locationId?: string | null },
) {
  return db.transaction(async (tx) => {
    const { result } = await runIdempotent(
      tx,
      { businessId: actor.businessId, operation: "purchase.create", key: input.idempotencyKey, payload: input },
      async (purchaseId) => {
        if (input.supplierId) {
          const [supplier] = await tx
            .select({ id: suppliers.id })
            .from(suppliers)
            .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.businessId, actor.businessId)))
            .limit(1);
          if (!supplier) throw new NotFoundError("Supplier not found");
        }

        const [created] = await tx
          .insert(purchases)
          .values({
            id: purchaseId,
            businessId: actor.businessId,
            locationId: input.locationId ?? null,
            supplierId: input.supplierId || null,
            invoiceNumber: input.invoiceNumber || null,
            purchaseDate: input.purchaseDate,
            status: "DRAFT",
            createdBy: actor.userId,
          })
          .returning();

        const locked = await lockIngredientsForUpdate(tx, actor.businessId, input.lines.map((line) => line.ingredientId));

        // The same ingredient may appear on two lines: each line blends over
        // the quantity and average the previous line left behind.
        const runningQuantity = new Map<string, number>();
        const runningAverageCost = new Map<string, number>();
        const lineRows: (typeof purchaseLines.$inferInsert)[] = [];
        const movements: MovementInput[] = [];
        let totalCost = 0;

        for (const line of input.lines) {
          const ingredient = locked.get(line.ingredientId)!;
          const quantityBaseUnits = convertToBaseUnits({
            quantityPurchased: line.quantityPurchased,
            conversionToBaseUnits: line.conversionToBaseUnits,
          });
          const totalLineCost = microsToRupiah(multiplyQuantityByRate(line.quantityPurchased, line.unitPurchaseCost));
          const costPerBaseUnit = totalLineCost / quantityBaseUnits;
          totalCost += totalLineCost;
          // Each is stored in a PostgreSQL integer / numeric column.
          if (totalLineCost > BOUNDS.maxInt || totalCost > BOUNDS.maxInt || quantityBaseUnits > BOUNDS.maxQuantity) {
            throw new ServiceError("This receipt is too large to record. Split it into smaller receipts.");
          }

          const existingQuantity = runningQuantity.get(line.ingredientId) ?? Number(ingredient.currentQuantityBaseUnits);
          const existingAverageCost = runningAverageCost.get(line.ingredientId) ?? Number(ingredient.averageCostPerBaseUnit);
          const newAverageCost = calculateWeightedAverageCost({
            existingQuantity,
            existingAverageCost,
            incomingQuantity: quantityBaseUnits,
            incomingCostPerUnit: costPerBaseUnit,
          });
          runningQuantity.set(line.ingredientId, existingQuantity + quantityBaseUnits);
          runningAverageCost.set(line.ingredientId, newAverageCost);

          lineRows.push({
            purchaseId: created.id,
            ingredientId: line.ingredientId,
            ingredientNameSnapshot: ingredient.name,
            ingredientBaseUnitSnapshot: ingredient.baseUnit,
            quantityPurchased: String(line.quantityPurchased),
            purchaseUnit: line.purchaseUnit,
            conversionToBaseUnits: String(line.conversionToBaseUnits),
            quantityBaseUnits: String(quantityBaseUnits),
            totalLineCost,
            costPerBaseUnit: String(costPerBaseUnit),
          });
          movements.push({
            id: randomUUID(),
            businessId: actor.businessId,
            locationId: input.locationId ?? null,
            ingredientId: line.ingredientId,
            movementType: "PURCHASE_RECEIPT",
            quantityUnits: toQuantityUnits(quantityBaseUnits),
            unitCost: String(costPerBaseUnit),
            totalCost: totalLineCost,
            sourceType: "purchase",
            sourceId: created.id,
            createdBy: actor.userId,
          });
        }

        await tx.insert(purchaseLines).values(lineRows);
        await insertMovementsAndApplyStock(tx, movements, locked, {
          averageCostPerBaseUnit: new Map([...runningAverageCost].map(([id, cost]) => [id, String(cost)])),
        });

        const [finalized] = await tx
          .update(purchases)
          .set({ status: "FINALIZED", totalCost, finalizedAt: new Date() })
          .where(eq(purchases.id, created.id))
          .returning();

        await recordAuditLog(tx, {
          businessId: actor.businessId,
          actorUserId: actor.userId,
          action: "purchase.finalized",
          entityType: "purchase",
          entityId: finalized.id,
          after: finalized,
        });

        return finalized;
      },
      async (id) => {
        const [row] = await tx.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.businessId, actor.businessId)));
        return row;
      },
    );
    return result;
  });
}
