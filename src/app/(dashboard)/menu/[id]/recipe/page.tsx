import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageAccess } from "@/lib/auth/guards";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { getMenuItemById } from "@/server/services/menu-service";
import { listIngredients } from "@/server/services/ingredient-service";
import { getActiveRecipe } from "@/server/services/recipe-service";
import { RecipeEditor } from "./recipe-editor";

export const metadata: Metadata = {
  title: "Recipe — CaféOps",
};

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const { id } = await params;
  const { variant: variantIdParam } = await searchParams;
  const user = await requirePageAccess("menu:read");
  const canWrite = hasAnyRolePermission(user.roles, "recipes:write");

  const detail = await getMenuItemById(db, user.businessId, id);
  if (!detail) notFound();

  const activeVariants = detail.variants.filter((v) => v.active);
  const selectedVariant =
    activeVariants.find((v) => v.id === variantIdParam) ?? activeVariants[0] ?? detail.variants[0];

  if (!selectedVariant) {
    return (
      <div className="mx-auto max-w-[800px]">
        <BackLink itemId={id} />
        <p className="mt-6 text-sm text-[var(--color-text-secondary)]">
          This item has no variants yet. Add a variant first, then come back to build its recipe.
        </p>
      </div>
    );
  }

  const [ingredients, recipe] = await Promise.all([
    listIngredients(db, user.businessId),
    getActiveRecipe(db, user.businessId, selectedVariant.id),
  ]);

  return (
    <div className="mx-auto max-w-[800px]">
      <BackLink itemId={id} />
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-text-primary)]">
        {detail.item.name} — Recipe
      </h1>

      {detail.variants.length > 1 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {detail.variants.map((v) => (
            <Link
              key={v.id}
              href={`/menu/${id}/recipe?variant=${v.id}`}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                v.id === selectedVariant.id
                  ? "border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
              }`}
            >
              {v.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        {/* Keyed by variant: the tabs above only change `?variant=`, so without
            a key React keeps this editor mounted across variants — and its
            lines live in state seeded once from `initialLines`. It would keep
            showing the previous variant's ingredients while `variantId` had
            already moved on, so Save would write them onto the wrong variant. */}
        <RecipeEditor
          key={selectedVariant.id}
          menuItemId={id}
          variantId={selectedVariant.id}
          variantName={selectedVariant.name}
          variantPrice={selectedVariant.price}
          ingredients={ingredients.map((ing) => ({
            id: ing.id,
            name: ing.name,
            baseUnit: ing.baseUnit,
            costPerBaseUnit: ing.averageCostPerBaseUnit,
          }))}
          initialLines={
            recipe?.lines.map((l) => ({
              ingredientId: l.ingredientId,
              quantityBaseUnits: Number(l.quantityBaseUnits),
              wastePercentage: Number(l.wastePercentage ?? 0),
              notes: l.notes ?? "",
            })) ?? []
          }
          canWrite={canWrite}
        />
      </div>
    </div>
  );
}

function BackLink({ itemId }: { itemId: string }) {
  return (
    <Link
      href={`/menu/${itemId}`}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
    >
      <ArrowLeft size={14} />
      Back to item
    </Link>
  );
}
