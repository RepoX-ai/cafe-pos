import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { SESSION_COOKIE_NAME, validateSessionToken, type SessionUser } from "./session";

/**
 * Reads the session cookie and validates it against the database — there is
 * no JWT shortcut, so a deactivated user or a revoked session loses access on
 * the very next request.
 *
 * React `cache` memoizes this for a single server render only (the layout and
 * page of one request share one lookup). It is never shared across requests
 * or users, and calls from Server Actions/Route Handlers are not memoized.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return validateSessionToken(db, token);
});

export async function requireCurrentUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}
