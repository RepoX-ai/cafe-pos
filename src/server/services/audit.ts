import { desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { auditLogs, users } from "@/lib/db/schema";

export interface AuditLogInput {
  businessId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Records an audit event. Never pass passwords, session tokens, or payment
 * secrets in `before`/`after`/`metadata` — those fields are written
 * verbatim to the audit_logs table (PRD §6.15 / §12).
 */
export async function recordAuditLog(db: Database, input: AuditLogInput): Promise<void> {
  await db.insert(auditLogs).values({
    businessId: input.businessId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    beforeSnapshot: input.before ?? null,
    afterSnapshot: input.after ?? null,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}

export async function countAuditLogs(db: Database, businessId: string) {
  return db.$count(auditLogs, eq(auditLogs.businessId, businessId));
}

export async function listAuditLogs(db: Database, businessId: string, window: { limit: number; offset: number }) {
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(eq(auditLogs.businessId, businessId))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(window.limit)
    .offset(window.offset);
}
