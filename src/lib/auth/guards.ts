import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "./current-user";
import { hasAnyRolePermission, type Permission } from "@/lib/permissions/permissions";
import type { SessionUser } from "./session";

/**
 * Use at the top of a page/layout Server Component. Not authenticated ->
 * redirect to /login. Authenticated but lacking the permission -> redirect
 * to /forbidden. This is the server-side enforcement the PRD requires —
 * it runs regardless of what nav links the UI happens to render.
 */
export async function requirePageAccess(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (permission && !hasAnyRolePermission(user.roles, permission)) {
    redirect("/forbidden");
  }
  return user;
}

/** True if the user's role set includes the "cashier-only" surface, per PRD §10. */
export function isCashierOnly(user: SessionUser): boolean {
  return user.roles.length > 0 && user.roles.every((r) => r === "cashier");
}
