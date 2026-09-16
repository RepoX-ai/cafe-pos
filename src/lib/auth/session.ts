import { randomBytes, createHash } from "node:crypto";
import { eq, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { roles, sessions, userRoles, users } from "@/lib/db/schema";
import type { RoleName } from "@/lib/permissions/permissions";

export const SESSION_COOKIE_NAME = "cafe_pos_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface SessionUser {
  id: string;
  businessId: string;
  name: string;
  email: string;
  active: boolean;
  roles: RoleName[];
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Database,
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
  });
  return { token, expiresAt };
}

/**
 * Validates a raw session token against the database. Returns null for any
 * missing, expired, or deactivated-user session — callers must treat null
 * as "not authenticated" and never distinguish the reason (avoids leaking
 * account-existence information).
 */
export async function validateSessionToken(
  db: Database,
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  // Session, user, and role names in one round trip.
  const [row] = await db
    .select({
      userId: users.id,
      businessId: users.businessId,
      name: users.name,
      email: users.email,
      active: users.active,
      expiresAt: sessions.expiresAt,
      roles: sql<string[]>`array(
        select ${roles.name}::text from ${userRoles}
        inner join ${roles} on ${roles.id} = ${userRoles.roleId}
        where ${userRoles.userId} = ${users.id}
      )`,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (!row.active) return null;

  return {
    id: row.userId,
    businessId: row.businessId,
    name: row.name,
    email: row.email,
    active: row.active,
    roles: row.roles as RoleName[],
  };
}

export async function invalidateSessionToken(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function invalidateAllUserSessions(db: Database, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Deletes up to `batchSize` expired sessions. Validation already rejects
 * expired rows, so correctness never depends on this — it only stops the
 * table growing by one row per login forever.
 */
export async function deleteExpiredSessions(db: Database, batchSize = 1000): Promise<number> {
  const expired = db.select({ id: sessions.id }).from(sessions).where(lt(sessions.expiresAt, sql`now()`)).limit(batchSize);
  const deleted = await db.delete(sessions).where(inArray(sessions.id, expired)).returning({ id: sessions.id });
  return deleted.length;
}
