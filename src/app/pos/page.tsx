import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
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
  const [{ categories, items }, business] = await Promise.all([
    getPosMenu(db, user.businessId),
    getBusinessById(db, user.businessId),
  ]);

  const tax = business ? parseTaxConfig(business.taxConfig) : null;
  const serviceChargePercent = business?.serviceChargePercent ? Number(business.serviceChargePercent) : null;

  return (
    <PosClient
      userName={user.name}
      categories={categories}
      items={items}
      tax={tax}
      serviceChargePercent={serviceChargePercent}
    />
  );
}
