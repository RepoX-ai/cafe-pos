"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { login, logout } from "@/server/services/auth-service";
import {
  createSession,
  deleteExpiredSessions,
  REMEMBERED_EMAIL_COOKIE_NAME,
  REMEMBERED_EMAIL_DURATION_S,
  resolveDefaultMembership,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getRequestMeta } from "@/lib/http/request-meta";
import {
  claimRateLimitCleanupSlot,
  clearRateLimits,
  consumeRateLimits,
  deleteExpiredRateLimitBuckets,
  RATE_LIMITS,
  type RateLimitCheck,
} from "@/server/services/rate-limit";
import { DEV_SEED_ACCOUNTS } from "@/lib/dev-seed-accounts";

export type LoginFormState = { error?: string } | undefined;

// Longest plausible email, and a password cap well above any real
// passphrase so an oversized body can't be pushed through hashing.
const MAX_IDENTIFIER_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const rememberEmail = formData.get("remember") === "on";

  if (!identifier || !password) {
    return { error: "Enter your email and password." };
  }

  const { ipAddress, userAgent } = await getRequestMeta();
  const account = identifier.toLowerCase().slice(0, MAX_IDENTIFIER_LENGTH);
  // Separate buckets (PRD §12): per client IP stops rotating identifiers
  // from one address; per account stops spreading guesses across addresses;
  // account + IP is the everyday allowance for one device. IP buckets only
  // exist when a trusted proxy supplies the IP (see lib/http/client-ip.ts).
  const accountIp: RateLimitCheck[] = ipAddress ? [{ rule: RATE_LIMITS.loginAccountIp(), key: [ipAddress, account] }] : [];
  const accountOnly: RateLimitCheck = { rule: RATE_LIMITS.loginAccount(), key: [account] };
  const checks: RateLimitCheck[] = [
    ...(ipAddress ? [{ rule: RATE_LIMITS.loginClientIp(), key: [ipAddress] }] : []),
    ...accountIp,
    accountOnly,
  ];

  const blocked = await consumeRateLimits(db, checks);
  if (claimRateLimitCleanupSlot()) {
    after(() => Promise.all([deleteExpiredRateLimitBuckets(db), deleteExpiredSessions(db)]).catch(() => undefined));
  }
  if (blocked) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  if (identifier.length > MAX_IDENTIFIER_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: "Incorrect email or password." };
  }

  const result = await login(db, identifier, password, { ipAddress, userAgent });

  if (!result.ok) {
    return {
      error:
        result.error === "busy"
          ? "The server is busy. Try again in a moment."
          : result.error === "account_deactivated"
          ? "This account has been deactivated. Contact your owner or manager."
          : result.error === "no_business_access"
            ? "This account no longer has access to any business. Contact your owner or manager."
            : "Incorrect email or password.",
    };
  }

  // The per-IP bucket is deliberately not cleared: otherwise one valid login
  // would reset an attacker's allowance for rotating other identifiers.
  await clearRateLimits(db, [...accountIp, accountOnly]);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: result.expiresAt,
  });

  // Only the identifier, and only once it has proven to be a real account,
  // so an unchecked box on a shared tablet also clears whoever came before.
  if (rememberEmail) {
    cookieStore.set(REMEMBERED_EMAIL_COOKIE_NAME, account, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REMEMBERED_EMAIL_DURATION_S,
    });
  } else {
    cookieStore.delete(REMEMBERED_EMAIL_COOKIE_NAME);
  }

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getCurrentUser();

  if (token && user) {
    await logout(db, token, { businessId: user.businessId, userId: user.id }, await getRequestMeta());
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

export type DevQuickLoginState = { error: string } | undefined;

/**
 * Dev-only, one-click sign-in as a seeded account (no password) — for
 * quickly switching between roles (e.g. Owner <-> Cashier) while
 * building/testing locally. Guarded twice: this action itself refuses to
 * run outside development regardless of what calls it, and it only ever
 * signs in as one of the fixed DEV_SEED_ACCOUNTS emails, never an
 * arbitrary address — so it can't become a general auth bypass even in
 * dev. See src/components/dev-role-switcher.tsx for the UI.
 */
export async function devQuickLoginAction(email: string): Promise<DevQuickLoginState> {
  if (process.env.NODE_ENV === "production") {
    return { error: "Not available in production." };
  }

  const account = DEV_SEED_ACCOUNTS.find((a) => a.email === email);
  if (!account) {
    return { error: "Unknown dev account." };
  }

  const [user] = await db.select().from(users).where(eq(users.email, account.email)).limit(1);
  if (!user) {
    return { error: `${account.email} doesn't exist yet — run "npm run db:seed" first.` };
  }
  if (!user.active) {
    return { error: `${account.email} has been deactivated.` };
  }

  // Drop any current session first so switching accounts doesn't leave
  // the previous one dangling.
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = await getCurrentUser();
  if (existingToken && currentUser) {
    await logout(db, existingToken, { businessId: currentUser.businessId, userId: currentUser.id });
  }

  const membership = await resolveDefaultMembership(db, user.id);
  if (!membership) {
    return { error: `${account.email} isn't a member of any business — run "npm run db:seed" first.` };
  }

  const { token, expiresAt } = await createSession(db, user.id, membership.membershipId, await getRequestMeta());

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: false, // the production guard above already ruled that out here
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  redirect("/"); // role-aware landing route decides /dashboard vs /pos
}
