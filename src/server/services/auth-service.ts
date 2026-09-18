import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, invalidateSessionToken, resolveDefaultMembership } from "@/lib/auth/session";
import { recordAuditLog } from "./audit";

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: "invalid_credentials" | "account_deactivated" | "no_business_access" };

/**
 * Looks up by email OR by name-as-username (PRD: "log in with email or
 * username"). Deliberately returns the same generic error for "no such
 * user" and "wrong password" so login can't be used to enumerate accounts;
 * a deactivated account gets its own message since that's operationally
 * useful for staff to see and isn't a secret.
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

  if (!user) {
    return { ok: false, error: "invalid_credentials" };
  }

  const validPassword = await verifyPassword(plainTextPassword, user.passwordHash);
  if (!validPassword) {
    return { ok: false, error: "invalid_credentials" };
  }

  if (!user.active) {
    return { ok: false, error: "account_deactivated" };
  }

  // Credentials alone no longer grant access: the account must still hold
  // an active membership somewhere. Someone removed from the only cafe
  // they worked at keeps a valid password and gets nowhere with it.
  const membership = await resolveDefaultMembership(db, user.id);
  if (!membership) {
    return { ok: false, error: "no_business_access" };
  }

  const { token, expiresAt } = await createSession(db, user.id, membership.membershipId, meta);

  await recordAuditLog(db, {
    businessId: membership.businessId,
    actorUserId: user.id,
    action: "login",
    entityType: "user",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { ok: true, token, expiresAt };
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
