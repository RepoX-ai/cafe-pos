import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { listIngredients } from "@/server/services/ingredient-service";
import { listSuppliers } from "@/server/services/supplier-service";
import { listPurchases } from "@/server/services/purchase-service";
import { PurchasesClient } from "./purchases-client";

export const metadata: Metadata = {
  title: "Purchases — CaféOps",
};

export default async function PurchasesPage() {
  const user = await requirePageAccess("purchases:write");

  const [ingredients, suppliers, purchases] = await Promise.all([
    listIngredients(db, user.businessId),
    listSuppliers(db, user.businessId),
    listPurchases(db, user.businessId),
  ]);

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Purchases</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Suppliers and purchase receipts. Finalizing a receipt increases stock and updates average cost.
      </p>

      <div className="mt-8">
        <PurchasesClient ingredients={ingredients} suppliers={suppliers} purchases={purchases} />
      </div>
    </div>
  );
}
