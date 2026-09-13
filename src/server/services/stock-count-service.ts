import type { Database } from "@/lib/db/client";
import { stockCountLines, stockCounts } from "@/lib/db/schema";
import type { StockCountInput } from "@/lib/validation/stock-count";
import { recordAuditLog } from "./audit";
import { insertMovementAndApplyStock, lockIngredientForUpdate } from "./inventory-service";
import type { ActorContext } from "./ingredient-service";

/**
 * Counts submit in one step here (the UI shows the system-vs-counted
 * preview client-side before the user confirms — PRD §6.6 "preview
 * adjustments, submit the count"). Only lines whose counted quantity
 * differs from the system quantity produce a STOCK_COUNT_CORRECTION
 * movement; matching lines are still recorded on the count for the audit
 * trail, just with a zero difference.
 */
export async function createAndSubmitStockCount(
  db: Database,
  actor: ActorContext,
  input: StockCountInput,
) {
  const stockCount = await db.transaction(async (tx) => {
    const [count] = await tx
      .insert(stockCounts)
      .values({
        businessId: actor.businessId,
        status: "SUBMITTED",
        countedBy: actor.userId,
        submittedAt: new Date(),
      })
      .returning();

    for (const line of input.lines) {
      const locked = await lockIngredientForUpdate(tx, actor.businessId, line.ingredientId);
      const systemQuantity = Number(locked.currentQuantityBaseUnits);
      const difference = line.countedQuantity - systemQuantity;

      await tx.insert(stockCountLines).values({
        stockCountId: count.id,
        ingredientId: line.ingredientId,
        systemQuantity: String(systemQuantity),
        countedQuantity: String(line.countedQuantity),
        differenceQuantity: String(difference),
      });

      if (difference !== 0) {
        await insertMovementAndApplyStock(
          tx,
          {
            businessId: actor.businessId,
            ingredientId: line.ingredientId,
            movementType: "STOCK_COUNT_CORRECTION",
            quantityBaseUnits: difference,
            sourceType: "stock_count",
            sourceId: count.id,
            reason: "Stock count correction",
            createdBy: actor.userId,
          },
          { newQuantityBaseUnits: line.countedQuantity },
        );
      }
    }

    return count;
  });

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "stock_count.submitted",
    entityType: "stock_count",
    entityId: stockCount.id,
    metadata: input,
  });

  return stockCount;
}
