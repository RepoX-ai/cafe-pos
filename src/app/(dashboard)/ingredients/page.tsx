import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { listIngredients } from "@/server/services/ingredient-service";
import { IngredientsClient } from "./ingredients-client";

export const metadata: Metadata = {
  title: "Ingredients — CaféOps",
};

export default async function IngredientsPage() {
  const user = await requirePageAccess("inventory:read");
  const canWrite = hasAnyRolePermission(user.roles, "ingredients:write");
  const ingredients = await listIngredients(db, user.businessId, { includeArchived: true });

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Ingredients</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Base-unit stock, cost, and reorder thresholds for every ingredient.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <IngredientsClient ingredients={ingredients} canWrite={canWrite} />
      </div>
    </div>
  );
}
