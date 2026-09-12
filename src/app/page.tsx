import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCashierOnly } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { LANDING_ROUTES } from "@/lib/navigation";

/**
 * Role-aware landing route (PRD §10): cashiers land on the POS. Everyone
 * else lands on the first page in LANDING_ROUTES they actually have
 * permission for — NOT hardcoded to /dashboard, since a role without
 * reports:read (e.g. inventory_staff) would immediately bounce off
 * /dashboard's own requirePageAccess("reports:read") into /forbidden.
 * Unauthenticated visitors go to /login.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (isCashierOnly(user)) {
    redirect("/pos");
  }
  const landing = LANDING_ROUTES.find((route) =>
    hasAnyRolePermission(user.roles, route.permission),
  );
  redirect(landing?.href ?? "/forbidden");
}
