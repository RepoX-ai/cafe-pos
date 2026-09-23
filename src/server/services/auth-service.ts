import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, invalidateSessionToken, resolveDefaultMembership } from "@/lib/auth/session";
import { recordAuditLog } from "./audit";
import { lockAccount } from "./locks";
import { WorkLimitExceededError } from "@/lib/work-limiter";

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: "invalid_credentials" | "account_deactivated" | "no_business_access" | "busy" };

/**
 * bcrypt cost-12 hash of a fixed dummy string. Used only when no user row
 * matches so a missing-account login still pays for one bcrypt.compare —
 * otherwise response time would reveal whether the email exists (SEC-004).
 * Never a real account password.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$12$wEYmVcXedq66c73xat6.3eWkPCrqq9MQP1mcoXgakyGCIQfatoYC2";

/**
 * Looks up by email (globally unique login identifier). Deliberately returns
 * the same generic error for "no such user" and "wrong password" so login
 * can't be used to enumerate accounts; a deactivated account gets its own
 * message since that's operationally useful for staff to see and isn't a
 * secret.
 *
 * Which business the new session lands in is decided here, from the
 * account's memberships — never from the login form. There is no input a
 * caller could supply to aim a session at a business they don't belong to.
 */
export async function login(
  db: Database,
  identifier: string,
  plainTextPassword: string,
  meta: RequestMeta = {},
): Promise<LoginResult> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, identifier.trim().toLowerCase()))
    .limit(1);

  // Always compare — against the real hash or a static dummy — so missing
  // and present accounts take a comparable amount of time. Refused as
  // "busy" (for present and missing accounts alike) when the bcrypt work
  // limit is saturated.
  let validPassword: boolean;
  try {
    validPassword = await verifyPassword(plainTextPassword, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  } catch (error) {
    if (error instanceof WorkLimitExceededError) return { ok: false, error: "busy" };
    throw error;
  }

  if (!user || !validPassword) {
    return { ok: false, error: "invalid_credentials" };
  }

  if (!user.active) {
    return { ok: false, error: "account_deactivated" };
  }

  // The session is created under a share lock on the account, re-checking
  // that the hash bcrypt just verified is still current. A password reset
  // takes the exclusive account lock and deletes the user's sessions in
  // the same transaction, so a login racing it either commits first (and
  // its session is deleted by the reset) or sees the new hash and fails —
  // never a surviving session minted from the old password.
  return db.transaction(async (tx): Promise<LoginResult> => {
    const account = await lockAccount(tx, user.id, "share");
    if (!account || account.passwordHash !== user.passwordHash) {
      return { ok: false, error: "invalid_credentials" };
    }
    if (!account.active) {
      return { ok: false, error: "account_deactivated" };
    }

    // Credentials alone no longer grant access: the account must still hold
    // an active membership somewhere. Someone removed from the only cafe
    // they worked at keeps a valid password and gets nowhere with it.
    const membership = await resolveDefaultMembership(tx, user.id);
    if (!membership) {
      return { ok: false, error: "no_business_access" };
    }

    const { token, expiresAt } = await createSession(tx, user.id, membership.membershipId, meta);

    await recordAuditLog(tx, {
      businessId: membership.businessId,
      actorUserId: user.id,
      action: "login",
      entityType: "user",
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { ok: true, token, expiresAt };
  });
}

export async function logout(
  db: Database,
  token: string,
  actor: { businessId: string; userId: string },
  meta: RequestMeta = {},
): Promise<void> {
  await invalidateSessionToken(db, token);
  await recordAuditLog(db, {
    businessId: actor.businessId,
    actorUserId: actor.userId,
    action: "logout",
    entityType: "user",
    entityId: actor.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}
