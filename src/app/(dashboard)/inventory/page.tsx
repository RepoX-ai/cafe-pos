import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { pageWindow, parsePageParam, toPage } from "@/lib/pagination";
import { ServerPagination } from "@/components/ui/server-pagination";
import { listIngredients } from "@/server/services/ingredient-service";
import { countMovements, describeMovementSources, listMovements } from "@/server/services/inventory-service";
import { InventoryClient } from "./inventory-client";

export const metadata: Metadata = {
  title: "Inventory — CaféOps",
};

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requirePageAccess("inventory:read");
  const canAdjust = hasAnyRolePermission(user.roles, "inventory:adjust");
  const window = pageWindow(parsePageParam((await searchParams).page));

  const [ingredients, rows, totalItems] = await Promise.all([
    listIngredients(db, user.businessId),
    listMovements(db, user.businessId, window),
    countMovements(db, user.businessId),
  ]);
  const movements = toPage(rows, window.page, window.pageSize);
  const sources = await describeMovementSources(db, user.businessId, movements.rows);

  return (
    <div className="mx-auto max-w-[1440px]">
      <InventoryClient
        ingredients={ingredients}
        movements={movements.rows.map((m) => ({ ...m, source: sources.get(m.id) ?? null }))}
        canViewOrders={hasAnyRolePermission(user.roles, "orders:read_all")}
        canViewPurchases={hasAnyRolePermission(user.roles, "purchases:write")}
        canAdjust={canAdjust}
        ledgerPagination={<ServerPagination page={{ ...movements, rowCount: movements.rows.length }} totalItems={totalItems} basePath="/inventory" />}
      />
    </div>
  );
}
