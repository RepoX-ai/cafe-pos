import type { Metadata } from "next";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import {
  listCategories,
  listMenuItemsWithVariants,
  listModifierGroupsWithOptions,
} from "@/server/services/menu-service";
import { listIngredients } from "@/server/services/ingredient-service";
import { MenuClient } from "./menu-client";

export const metadata: Metadata = {
  title: "Menu — CaféOps",
};

export default async function MenuPage() {
  const user = await requirePageAccess("menu:read");
  const canWrite = hasAnyRolePermission(user.roles, "menu:write");
  const canWriteRecipes = hasAnyRolePermission(user.roles, "recipes:write");

  const [categories, items, modifierGroups, ingredients] = await Promise.all([
    listCategories(db, user.businessId),
    listMenuItemsWithVariants(db, user.businessId),
    listModifierGroupsWithOptions(db, user.businessId),
    listIngredients(db, user.businessId),
  ]);

  return (
    <div className="mx-auto max-w-[1440px]">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Menu</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Categories, items, variants, and modifiers.
      </p>

      <div className="mt-8">
        <MenuClient
          categories={categories}
          items={items}
          modifierGroups={modifierGroups}
          ingredients={ingredients.map((ing) => ({
            id: ing.id,
            name: ing.name,
            baseUnit: ing.baseUnit,
            costPerBaseUnit: ing.averageCostPerBaseUnit,
          }))}
          canWrite={canWrite}
          canWriteRecipes={canWriteRecipes}
        />
      </div>
    </div>
  );
}
