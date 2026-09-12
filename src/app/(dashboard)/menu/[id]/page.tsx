import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { getMenuItemById, listCategories, listModifierGroupsWithOptions } from "@/server/services/menu-service";
import { listIngredients } from "@/server/services/ingredient-service";
import { ItemDetailClient } from "./item-detail-client";

export const metadata: Metadata = {
  title: "Menu item — CaféOps",
};

export default async function MenuItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess("menu:read");
  const canWrite = hasAnyRolePermission(user.roles, "menu:write");
  const canWriteRecipe = hasAnyRolePermission(user.roles, "recipes:write");

  const [detail, categories, modifierGroups, ingredients] = await Promise.all([
    getMenuItemById(db, user.businessId, id),
    listCategories(db, user.businessId),
    listModifierGroupsWithOptions(db, user.businessId),
    listIngredients(db, user.businessId),
  ]);

  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-[900px]">
      <ItemDetailClient
        item={detail.item}
        variants={detail.variants}
        assignedModifierGroupIds={detail.assignedModifierGroupIds}
        categories={categories}
        modifierGroups={modifierGroups}
        ingredients={ingredients.map((ing) => ({
          id: ing.id,
          name: ing.name,
          baseUnit: ing.baseUnit,
          costPerBaseUnit: ing.averageCostPerBaseUnit,
        }))}
        canWrite={canWrite}
        canWriteRecipe={canWriteRecipe}
      />
    </div>
  );
}
