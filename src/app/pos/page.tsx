import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { formatRoles } from "@/lib/permissions/role-labels";
import { db } from "@/lib/db/client";
import { getPosMenu } from "@/server/services/menu-service";
import { getBusinessById } from "@/server/services/business-service";
import { parseTaxConfig } from "@/lib/settings/tax";
import { PosClient } from "./pos-client";

export const metadata: Metadata = {
  title: "POS — CaféOps",
};

export default async function PosPage() {
  const user = await requirePageAccess("orders:create");
  const business = await getBusinessById(db, user.businessId);
  const { categories, items } = await getPosMenu(db, user.businessId, {
    allowNegativeStock: business?.allowNegativeStock ?? false,
  });

  const tax = business ? parseTaxConfig(business.taxConfig) : null;
  const serviceChargePercent = business?.serviceChargePercent ? Number(business.serviceChargePercent) : null;
  const canViewOrderHistory =
    hasAnyRolePermission(user.roles, "orders:read_all_basic") || hasAnyRolePermission(user.roles, "orders:read_all");

  return (
    <PosClient
      draftScope={`${user.businessId}:${user.id}`}
      userName={user.name}
      roleLabel={formatRoles(user.roles)}
      categories={categories}
      items={items}
      tax={tax}
      serviceChargePercent={serviceChargePercent}
      canViewOrderHistory={canViewOrderHistory}
    />
  );
}
