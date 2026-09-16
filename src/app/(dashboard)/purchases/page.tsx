import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { pageWindow, parsePageParam, toPage } from "@/lib/pagination";
import { ServerPagination } from "@/components/ui/server-pagination";
import { listIngredients } from "@/server/services/ingredient-service";
import { listSuppliers } from "@/server/services/supplier-service";
import { countPurchases, listPurchases } from "@/server/services/purchase-service";
import { PurchasesClient } from "./purchases-client";

export const metadata: Metadata = {
  title: "Purchases — CaféOps",
};

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const user = await requirePageAccess("purchases:write");
  const { tab, page } = await searchParams;
  const window = pageWindow(parsePageParam(page));

  const [ingredients, suppliers, purchaseRows, totalItems] = await Promise.all([
    listIngredients(db, user.businessId),
    listSuppliers(db, user.businessId, { includeArchived: true }),
    listPurchases(db, user.businessId, window),
    countPurchases(db, user.businessId),
  ]);
  const purchases = toPage(purchaseRows, window.page, window.pageSize);

  return (
    <div className="mx-auto max-w-[1440px]">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Purchases</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Suppliers and purchase receipts. Finalizing a receipt increases stock and updates average cost.
      </p>

      <div className="mt-8">
        <PurchasesClient
          ingredients={ingredients}
          suppliers={suppliers}
          purchases={purchases.rows}
          initialTab={tab === "history" || tab === "suppliers" ? tab : "new"}
          historyPagination={
            <ServerPagination
              page={{ ...purchases, rowCount: purchases.rows.length }}
              totalItems={totalItems}
              basePath="/purchases"
              params={{ tab: "history" }}
            />
          }
        />
      </div>
    </div>
  );
}
