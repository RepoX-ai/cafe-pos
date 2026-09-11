import type { Database } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";

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
