import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { SESSION_COOKIE_NAME, validateSessionToken, type SessionUser } from "./session";

/**
 * Reads the session cookie and validates it against the database on every
 * call — there is no in-memory/JWT shortcut, so a deactivated user or a
 * revoked session loses access on the very next request.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return validateSessionToken(db, token);
}

export async function requireCurrentUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}
