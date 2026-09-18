import { requirePageAccess, isCashierOnly } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { listMemberships } from "@/lib/auth/session";
import { brandStyle } from "@/lib/branding/branding";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { formatRoles } from "@/lib/permissions/role-labels";
import { AdminShell } from "@/components/admin-shell";
import { NAV_ITEMS } from "@/lib/navigation";

/**
 * Shared shell for every admin/operations screen. Cashiers never see this
 * layout — they're routed to /pos and redirected out if they try a URL
 * under this group (PRD §10: "Cashier lands on the POS ... receives a
 * permission error or redirect if attempting to open an admin route").
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageAccess();
  if (isCashierOnly(user)) {
    redirect("/forbidden");
  }

  // The extra lookup only happens for accounts that hold more than one
  // business, which is the rare case — everyone else pays one count that
  // validating the session already did.
  const [business, memberships] = await Promise.all([
    getCurrentBusiness(user.businessId),
    user.membershipCount > 1 ? listMemberships(db, user.id) : Promise.resolve([]),
  ]);

  const visibleNavItems = NAV_ITEMS.filter((item) =>
    hasAnyRolePermission(user.roles, item.permission),
  );

  return (
    <AdminShell
      userName={user.name}
      roleLabel={formatRoles(user.roles)}
      businessName={business?.name ?? "CaféOps"}
      logoUrl={business?.logoUrl ?? null}
      brandStyle={brandStyle(business?.brandColor)}
      visibleNavItems={visibleNavItems}
      canUsePos={hasAnyRolePermission(user.roles, "orders:create")}
      activeMembershipId={user.membershipId}
      businessOptions={memberships.map((membership) => ({
        membershipId: membership.membershipId,
        businessName: membership.businessName,
        roleLabel: formatRoles(membership.roles),
      }))}
    >
      {children}
    </AdminShell>
  );
}
