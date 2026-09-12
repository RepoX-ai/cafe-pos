"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { login, logout } from "@/server/services/auth-service";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/current-user";
import { clearLoginAttempts, consumeLoginAttempt } from "@/server/services/login-rate-limit";
import { DEV_SEED_ACCOUNTS } from "@/lib/dev-seed-accounts";

export type LoginFormState = { error?: string } | undefined;

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!identifier || !password) {
    return { error: "Enter your email and password." };
  }

  const headerList = await headers();
  const ipAddress = headerList.get("x-forwarded-for");
  // Rate-limit by IP+email so one attacker can't lock out someone else's
  // account, and one compromised account can't be brute-forced from a
  // single IP either (PRD §12).
  const rateLimitKey = `${ipAddress ?? "unknown"}:${identifier.toLowerCase()}`;

  if (!(await consumeLoginAttempt(db, rateLimitKey))) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const result = await login(db, identifier, password, {
    ipAddress,
    userAgent: headerList.get("user-agent"),
  });

  if (!result.ok) {
    return {
      error:
        result.error === "account_deactivated"
          ? "This account has been deactivated. Contact your owner or manager."
          : "Incorrect email or password.",
    };
  }

  await clearLoginAttempts(db, rateLimitKey);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: result.expiresAt,
  });

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getCurrentUser();

  if (token && user) {
    const headerList = await headers();
    await logout(
      db,
      token,
      { businessId: user.businessId, userId: user.id },
      {
        ipAddress: headerList.get("x-forwarded-for"),
        userAgent: headerList.get("user-agent"),
      },
    );
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

  const headerList = await headers();
  const { token, expiresAt } = await createSession(db, user.id, {
    ipAddress: headerList.get("x-forwarded-for"),
    userAgent: headerList.get("user-agent"),
  });

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: false, // the production guard above already ruled that out here
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  redirect("/"); // role-aware landing route decides /dashboard vs /pos
}
