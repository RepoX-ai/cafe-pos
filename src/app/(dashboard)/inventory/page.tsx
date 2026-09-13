import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { listIngredients } from "@/server/services/ingredient-service";
import { listMovements } from "@/server/services/inventory-service";
import { InventoryClient } from "./inventory-client";

export const metadata: Metadata = {
  title: "Inventory — CaféOps",
};

export default async function InventoryPage() {
  const user = await requirePageAccess("inventory:read");
  const canAdjust = hasAnyRolePermission(user.roles, "inventory:adjust");

  const [ingredients, movements] = await Promise.all([
    listIngredients(db, user.businessId),
    listMovements(db, user.businessId, { limit: 200 }),
  ]);

  return (
    <div className="mx-auto max-w-[1440px]">
      <InventoryClient ingredients={ingredients} movements={movements} canAdjust={canAdjust} />
    </div>
  );
}
