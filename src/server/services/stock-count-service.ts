import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/db/client";
import { stockCountLines, stockCounts } from "@/lib/db/schema";
import { formatQuantityUnits, toQuantityUnits } from "@/lib/units/units";
import type { StockCountInput } from "@/lib/validation/stock-count";
import { recordAuditLog } from "./audit";
import { insertMovementsAndApplyStock, lockIngredientsForUpdate, type MovementInput } from "./inventory-service";
import type { ActorContext } from "./ingredient-service";

/**
 * Counts submit in one step here (the UI shows the system-vs-counted
 * preview client-side before the user confirms — PRD §6.6 "preview
 * adjustments, submit the count"). Only lines whose counted quantity
 * differs from the system quantity produce a STOCK_COUNT_CORRECTION
 * movement; matching lines are still recorded on the count for the audit
 * trail, just with a zero difference. All ingredient locks are taken up
 * front in id order, and the lines and movements are written as one batch
 * each — a full-shelf count is a handful of statements, not one per row.
 */
export async function createAndSubmitStockCount(
  db: Database,
  actor: ActorContext,
  input: StockCountInput,
) {
  return db.transaction(async (tx) => {
    const [count] = await tx
      .insert(stockCounts)
      .values({
        businessId: actor.businessId,
        status: "SUBMITTED",
        countedBy: actor.userId,
        submittedAt: new Date(),
      })
      .returning();

    const locked = await lockIngredientsForUpdate(tx, actor.businessId, input.lines.map((line) => line.ingredientId));

    // An ingredient counted twice is corrected twice, each line against
    // the quantity the previous line set.
    const running = new Map<string, bigint>();
    const lineRows: (typeof stockCountLines.$inferInsert)[] = [];
    const movements: MovementInput[] = [];

    for (const line of input.lines) {
      const ingredient = locked.get(line.ingredientId)!;
      const systemUnits = running.get(line.ingredientId) ?? toQuantityUnits(ingredient.currentQuantityBaseUnits);
      const countedUnits = toQuantityUnits(line.countedQuantity);
      const differenceUnits = countedUnits - systemUnits;
      running.set(line.ingredientId, countedUnits);

      lineRows.push({
        stockCountId: count.id,
        ingredientId: line.ingredientId,
        ingredientNameSnapshot: ingredient.name,
        ingredientBaseUnitSnapshot: ingredient.baseUnit,
        systemQuantity: formatQuantityUnits(systemUnits),
        countedQuantity: formatQuantityUnits(countedUnits),
        differenceQuantity: formatQuantityUnits(differenceUnits),
      });

      if (differenceUnits !== 0n) {
        movements.push({
          id: randomUUID(),
          businessId: actor.businessId,
          ingredientId: line.ingredientId,
          movementType: "STOCK_COUNT_CORRECTION",
          quantityUnits: differenceUnits,
          sourceType: "stock_count",
          sourceId: count.id,
          reason: "Stock count correction",
          createdBy: actor.userId,
        });
      }
    }

    if (lineRows.length > 0) await tx.insert(stockCountLines).values(lineRows);
    await insertMovementsAndApplyStock(tx, movements, locked);

    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "stock_count.submitted",
      entityType: "stock_count",
      entityId: count.id,
      metadata: input,
    });

    return count;
  });
}
