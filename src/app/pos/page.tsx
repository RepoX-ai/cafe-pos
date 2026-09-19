import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { formatRoles } from "@/lib/permissions/role-labels";
import { db } from "@/lib/db/client";
import { getCachedPosMenu } from "@/server/services/pos-menu-cache";
import { getBusinessById } from "@/server/services/business-service";
import { listMemberships } from "@/lib/auth/session";
import { brandStyle } from "@/lib/branding/branding";
import { parseTaxConfig } from "@/lib/settings/tax";
import { PosClient } from "./pos-client";

export const metadata: Metadata = {
  title: "POS — CaféOps",
};

export default async function PosPage() {
  const user = await requirePageAccess("orders:create");
  const business = await getBusinessById(db, user.businessId);
  const { categories, items } = await getCachedPosMenu(user.businessId, {
    allowNegativeStock: business?.allowNegativeStock ?? false,
  });

  // Only for accounts that hold more than one business — the count comes
  // free with the session, so a single-café cashier pays nothing for this.
  const memberships = user.membershipCount > 1 ? await listMemberships(db, user.id) : [];

  const tax = business ? parseTaxConfig(business.taxConfig) : null;
  const serviceChargePercent = business?.serviceChargePercent ? Number(business.serviceChargePercent) : null;
  const canViewOrderHistory =
    hasAnyRolePermission(user.roles, "orders:read_all_basic") || hasAnyRolePermission(user.roles, "orders:read_all");

  return (
    <PosClient
      draftScope={`${user.businessId}:${user.id}`}
      userName={user.name}
      roleLabel={formatRoles(user.roles)}
      businessName={business?.name ?? "CaféOps"}
      logoUrl={business?.logoUrl ?? null}
      brandStyle={brandStyle(business?.brandColor)}
      activeMembershipId={user.membershipId}
      businessOptions={memberships.map((membership) => ({
        membershipId: membership.membershipId,
        businessName: membership.businessName,
        roleLabel: formatRoles(membership.roles),
      }))}
      categories={categories}
      items={items}
      tax={tax}
      serviceChargePercent={serviceChargePercent}
      canViewOrderHistory={canViewOrderHistory}
    />
  );
}
