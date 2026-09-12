import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { suppliers } from "@/lib/db/schema";
import { recordAuditLog } from "./audit";
import type { ActorContext } from "./ingredient-service";

export interface SupplierInput {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export async function listSuppliers(db: Database, businessId: string, opts: { includeArchived?: boolean } = {}) {
  return db
    .select()
    .from(suppliers)
    .where(
      opts.includeArchived
        ? eq(suppliers.businessId, businessId)
        : and(eq(suppliers.businessId, businessId), eq(suppliers.active, true)),
    )
    .orderBy(asc(suppliers.name));
}

export async function createSupplier(db: Database, actor: ActorContext, input: SupplierInput) {
  const [row] = await db
    .insert(suppliers)
    .values({
      businessId: actor.businessId,
      name: input.name,
      contactName: input.contactName || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
    })
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "supplier.created",
    entityType: "supplier",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateSupplier(db: Database, actor: ActorContext, id: string, input: SupplierInput) {
  const [row] = await db
    .update(suppliers)
    .set({
      name: input.name,
      contactName: input.contactName || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null,
      updatedAt: new Date(),
    })
    .where(and(eq(suppliers.id, id), eq(suppliers.businessId, actor.businessId)))
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "supplier.updated",
    entityType: "supplier",
    entityId: id,
    after: row,
  });
  return row;
}

export async function setSupplierActive(db: Database, actor: ActorContext, id: string, active: boolean) {
  const [row] = await db
    .update(suppliers)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(suppliers.id, id), eq(suppliers.businessId, actor.businessId)))
    .returning();
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: active ? "supplier.restored" : "supplier.archived",
    entityType: "supplier",
    entityId: id,
    after: row,
  });
  return row;
}
