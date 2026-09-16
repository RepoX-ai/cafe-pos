"use client";

import { useMemo, useState } from "react";
import { ItemsTab } from "./menu-items-tab";
import { CategoriesTab } from "./menu-categories-tab";
import { ModifiersTab } from "./menu-modifiers-tab";
import type { CategoryRow, MenuItemRow, ModifierGroupRow } from "./menu-types";
import type { IngredientOption } from "./recipe-lines-table";

/**
 * Menu admin: one tab per responsibility (items, categories, modifiers), each
 * owning its own filters, dialogs, and row actions.
 */
type Tab = "items" | "categories" | "modifiers";

export function MenuClient({
  categories,
  items,
  modifierGroups,
  ingredients,
  canWrite,
  canWriteRecipes,
}: {
  categories: CategoryRow[];
  items: MenuItemRow[];
  modifierGroups: ModifierGroupRow[];
  ingredients: IngredientOption[];
  canWrite: boolean;
  canWriteRecipes: boolean;
}) {
  const [tab, setTab] = useState<Tab>("items");
  // Deleting a category leaves its items behind as uncategorized, so the
  // confirm dialog says how many that will be.
  const itemsPerCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.categoryId) counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-[var(--color-border)]">
        {(
          [
            ["items", "Items"],
            ["categories", "Categories"],
            ["modifiers", "Modifiers"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === value
                ? "border-[var(--color-accent-primary)] text-[var(--color-text-primary)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "items" ? (
        <ItemsTab items={items} categories={categories} canWrite={canWrite} />
      ) : null}
      {tab === "categories" ? (
        <CategoriesTab categories={categories} itemsPerCategory={itemsPerCategory} canWrite={canWrite} />
      ) : null}
      {tab === "modifiers" ? <ModifiersTab groups={modifierGroups} ingredients={ingredients} canWrite={canWrite} canWriteRecipes={canWriteRecipes} /> : null}
    </div>
  );
}
