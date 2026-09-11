import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { getMenuItemById, listCategories, listModifierGroupsWithOptions } from "@/server/services/menu-service";
import { ItemDetailClient } from "./item-detail-client";

export const metadata: Metadata = {
  title: "Menu item — CaféOps",
};

export default async function MenuItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageAccess("menu:read");
  const canWrite = hasAnyRolePermission(user.roles, "menu:write");

  const [detail, categories, modifierGroups] = await Promise.all([
    getMenuItemById(db, user.businessId, id),
    listCategories(db, user.businessId),
    listModifierGroupsWithOptions(db, user.businessId),
  ]);

  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-[900px] px-8 py-10">
      <ItemDetailClient
        item={detail.item}
        variants={detail.variants}
        assignedModifierGroupIds={detail.assignedModifierGroupIds}
        categories={categories}
        modifierGroups={modifierGroups}
        canWrite={canWrite}
      />
    </div>
  );
}
