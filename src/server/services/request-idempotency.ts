import { createHash, randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { requestIdempotency } from "@/lib/db/schema";
import { IdempotencyMismatchError } from "./errors";

export type IdempotentOperation = "purchase.create" | "waste.create" | "inventory.adjust" | "stock_count.submit" | "expense.create";

/** Stable hash of a validated payload: object keys sorted, so field order never matters. */
export function payloadHash(payload: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .filter((key) => key !== "idempotencyKey" && (value as Record<string, unknown>)[key] !== undefined)
          .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}

/**
 * Runs `create` at most once per (business, operation, key). Must be called
 * inside the transaction that performs the write, and before it:
 *
 * - The claim row is inserted first, carrying the id the new entity will
 *   get. It commits or rolls back together with the write it guards.
 * - A retry after the original committed finds the claim and gets
 *   `load(entityId)` back — nothing is written twice. A concurrent duplicate
 *   waits on the claim's primary key until the first transaction ends, then
 *   does the same (or, if the first rolled back, runs normally).
 * - The same key with a different payload is refused.
 *
 * With no key (an older client), `create` just runs — unchanged behaviour.
 */
export async function runIdempotent<T>(
  tx: Database,
  scope: { businessId: string; operation: IdempotentOperation; key: string | undefined; payload: unknown },
  create: (entityId: string) => Promise<T>,
  load: (entityId: string) => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const entityId = randomUUID();
  if (!scope.key) return { result: await create(entityId), replayed: false };

  const requestHash = payloadHash(scope.payload);
  const claimed = await tx
    .insert(requestIdempotency)
    .values({ businessId: scope.businessId, operation: scope.operation, key: scope.key, requestHash, entityId })
    .onConflictDoNothing()
    .returning({ entityId: requestIdempotency.entityId });
  if (claimed.length > 0) return { result: await create(entityId), replayed: false };

  const [existing] = await tx
    .select()
    .from(requestIdempotency)
    .where(
      and(
        eq(requestIdempotency.businessId, scope.businessId),
        eq(requestIdempotency.operation, scope.operation),
        eq(requestIdempotency.key, scope.key),
      ),
    );
  if (!existing || existing.requestHash !== requestHash) throw new IdempotencyMismatchError();
  return { result: await load(existing.entityId), replayed: true };
}

/** Retention sweep: keys only need to outlive the retry window. Bounded batches, like the rate-limit cleanup. */
export async function deleteExpiredIdempotencyKeys(db: Database, olderThanDays = 7, batchSize = 1000): Promise<number> {
  const result = await db.execute(sql`
    delete from ${requestIdempotency}
    where (business_id, operation, key) in (
      select business_id, operation, key from ${requestIdempotency}
      where ${lt(requestIdempotency.createdAt, sql`now() - make_interval(days => ${olderThanDays}::int)`)}
      limit ${batchSize}
    )
  `);
  return result.rowCount ?? 0;
}
