"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { login, logout } from "@/server/services/auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/current-user";
import { clearAttempts, isRateLimited, recordAttempt } from "@/lib/auth/rate-limit";

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

  if (isRateLimited(rateLimitKey)) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const result = await login(db, identifier, password, {
    ipAddress,
    userAgent: headerList.get("user-agent"),
  });

  if (!result.ok) {
    recordAttempt(rateLimitKey);
    return {
      error:
        result.error === "account_deactivated"
          ? "This account has been deactivated. Contact your owner or manager."
          : "Incorrect email or password.",
    };
  }

  clearAttempts(rateLimitKey);

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
