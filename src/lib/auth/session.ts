import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { businesses, membershipRoles, memberships, roles, sessions, users } from "@/lib/db/schema";
import type { RoleName } from "@/lib/permissions/permissions";

export const SESSION_COOKIE_NAME = "cafe_pos_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

/**
 * `businessId` is the business this session is *currently* acting in, not
 * a property of the account — a user may hold memberships in several. It
 * keeps its name because every caller already treats it as "the tenant for
 * this request", and that reading is still exactly right.
 */
export interface SessionUser {
  id: string;
  membershipId: string;
  businessId: string;
  businessName: string;
  name: string;
  email: string;
  active: boolean;
  roles: RoleName[];
  /** >1 means this person can switch businesses; the shell shows a picker. */
  membershipCount: number;
}

export interface MembershipOption {
  membershipId: string;
  businessId: string;
  businessName: string;
  roles: RoleName[];
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Active memberships for one user, most recently used first — the order
 * the switcher lists them in, and the order `resolveDefaultMembership`
 * picks from at login.
 */
export async function listMemberships(db: Database, userId: string): Promise<MembershipOption[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      businessId: memberships.businessId,
      businessName: businesses.name,
      roles: sql<string[]>`array(
        select ${roles.name}::text from ${membershipRoles}
        inner join ${roles} on ${roles.id} = ${membershipRoles.roleId}
        where ${membershipRoles.membershipId} = ${memberships.id}
      )`,
    })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
    .orderBy(desc(memberships.lastUsedAt));

  return rows.map((row) => ({ ...row, roles: row.roles as RoleName[] }));
}

/** The business a returning user lands in: whichever they used last. */
export async function resolveDefaultMembership(
  db: Database,
  userId: string,
): Promise<{ membershipId: string; businessId: string } | null> {
  const [row] = await db
    .select({ membershipId: memberships.id, businessId: memberships.businessId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
    .orderBy(desc(memberships.lastUsedAt))
    .limit(1);
  return row ?? null;
}

export async function createSession(
  db: Database,
  userId: string,
  membershipId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.insert(sessions).values({
    userId,
    activeMembershipId: membershipId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
  });
  await db
    .update(memberships)
    .set({ lastUsedAt: new Date() })
    .where(eq(memberships.id, membershipId));
  return { token, expiresAt };
}

/**
 * Points one session at a different business. The membership is re-checked
 * against that session's own user, so a stolen or guessed membership id
 * can't move a session into someone else's café — this is the
 * authorization boundary for the switcher, not the UI that lists the
 * options. Returns the business the session moved into, or null if the
 * membership isn't theirs or is inactive.
 *
 * Scoped to the single session holding `token`, deliberately: the active
 * business is a property of one browser, so an owner switching to café B
 * on their laptop must not drag the POS tablet running café A with them.
 */
export async function setActiveMembership(
  db: Database,
  userId: string,
  membershipId: string,
  token: string,
): Promise<{ businessId: string } | null> {
  const [membership] = await db
    .select({ id: memberships.id, businessId: memberships.businessId })
    .from(memberships)
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.userId, userId),
        eq(memberships.active, true),
      ),
    )
    .limit(1);
  if (!membership) return null;

  return db.transaction(async (tx) => {
    const moved = await tx
      .update(sessions)
      .set({ activeMembershipId: membershipId })
      .where(and(eq(sessions.tokenHash, hashToken(token)), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });
    if (moved.length === 0) return null;

    await tx
      .update(memberships)
      .set({ lastUsedAt: new Date() })
      .where(eq(memberships.id, membershipId));
    return { businessId: membership.businessId };
  });
}

/**
 * Validates a raw session token against the database. Returns null for any
 * missing, expired, deactivated-user, or revoked-membership session —
 * callers must treat null as "not authenticated" and never distinguish the
 * reason (avoids leaking account-existence information).
 *
 * The membership join is what makes this multi-tenant safe: the tenant for
 * the request comes from the session row, never from anything the client
 * sends, so there is no request in which a caller can name its own tenant.
 */
export async function validateSessionToken(
  db: Database,
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  // Session, user, active business, and role names in one round trip.
  const [row] = await db
    .select({
      userId: users.id,
      membershipId: memberships.id,
      businessId: memberships.businessId,
      businessName: businesses.name,
      membershipActive: memberships.active,
      name: users.name,
      email: users.email,
      active: users.active,
      expiresAt: sessions.expiresAt,
      roles: sql<string[]>`array(
        select ${roles.name}::text from ${membershipRoles}
        inner join ${roles} on ${roles.id} = ${membershipRoles.roleId}
        where ${membershipRoles.membershipId} = ${memberships.id}
      )`,
      membershipCount: sql<number>`(
        select count(*)::int from ${memberships} m
        where m.user_id = ${users.id} and m.active = true
      )`,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(memberships, eq(sessions.activeMembershipId, memberships.id))
    .innerJoin(businesses, eq(memberships.businessId, businesses.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (!row.active) return null;
  if (!row.membershipActive) return null;

  return {
    id: row.userId,
    membershipId: row.membershipId,
    businessId: row.businessId,
    businessName: row.businessName,
    name: row.name,
    email: row.email,
    active: row.active,
    roles: row.roles as RoleName[],
    membershipCount: row.membershipCount,
  };
}

export async function invalidateSessionToken(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function invalidateAllUserSessions(db: Database, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Drops only the sessions currently acting in one business, leaving the
 * same person's sessions in their other businesses alone. Revoking a
 * membership uses this: losing one café must not sign you out of another.
 */
export async function invalidateMembershipSessions(db: Database, membershipId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.activeMembershipId, membershipId));
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
