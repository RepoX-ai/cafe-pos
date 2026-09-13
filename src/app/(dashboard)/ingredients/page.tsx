import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { getRecipeUsageByIngredient, listIngredients } from "@/server/services/ingredient-service";
import { IngredientsClient } from "./ingredients-client";

export const metadata: Metadata = {
  title: "Ingredients — CaféOps",
};

export default async function IngredientsPage() {
  const user = await requirePageAccess("inventory:read");
  const canWrite = hasAnyRolePermission(user.roles, "ingredients:write");
  const [ingredients, recipeUsage] = await Promise.all([
    listIngredients(db, user.businessId, { includeArchived: true }),
    getRecipeUsageByIngredient(db, user.businessId),
  ]);

  return (
    <div className="mx-auto max-w-[1440px]">
      <IngredientsClient ingredients={ingredients} recipeUsage={recipeUsage} canWrite={canWrite} />
    </div>
  );
}
