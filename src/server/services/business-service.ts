import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { businesses } from "@/lib/db/schema";
import { serializeTaxConfig } from "@/lib/settings/tax";
import type { BusinessSettingsInput } from "@/lib/validation/settings";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

export async function getBusinessById(db: Database, businessId: string) {
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return business ?? null;
}

export async function updateBusinessSettings(
  db: Database,
  actor: ActorContext,
  input: BusinessSettingsInput,
) {
  const before = await getBusinessById(db, actor.businessId);

  const [row] = await db
    .update(businesses)
    .set({
      name: input.name,
      receiptFooter: input.receiptFooter || null,
      orderNumberPrefix: input.orderNumberPrefix,
      taxConfig: input.taxEnabled
        ? serializeTaxConfig({ percent: input.taxPercent, inclusive: input.taxInclusive })
        : null,
      serviceChargePercent: input.serviceChargeEnabled ? String(input.serviceChargePercent) : null,
      allowNegativeStock: input.allowNegativeStock,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, actor.businessId))
    .returning();

  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "settings.updated",
    entityType: "business",
    entityId: actor.businessId,
    before,
    after: row,
  });

  return row;
}
