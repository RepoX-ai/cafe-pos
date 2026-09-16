"use client";

import { Plus, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { calculateRecipeLineCost } from "@/lib/recipes/cost";
import { formatIDR } from "@/lib/money/money";

export interface IngredientOption {
  id: string;
  name: string;
  baseUnit: "gram" | "millilitre" | "piece";
  costPerBaseUnit: string;
}

export interface RecipeLineDraft {
  key: string;
  ingredientId: string;
  quantityBaseUnits: number;
  wastePercentage: number;
  notes: string;
}

const UNIT_LABEL: Record<IngredientOption["baseUnit"], string> = {
  gram: "g",
  millilitre: "ml",
  piece: "pc",
};

let keySeq = 0;
export function newRecipeLineKey() {
  keySeq += 1;
  return `line-${keySeq}`;
}

/**
 * The ingredient-lines table shared by the standalone recipe editor
 * (menu/[id]/recipe/recipe-editor.tsx) and the "Add variant" modal
 * (menu/[id]/item-detail-client.tsx) — both let someone build a recipe's
 * ingredient list, they just differ in what surrounds it (cost/margin
 * metrics + a dedicated save button on the recipe page; folded into
 * variant creation in the modal).
 */
export function RecipeLinesTable({
  lines,
  ingredients,
  canWrite,
  onUpdateLine,
  onRemoveLine,
  onAddLine,
}: {
  lines: RecipeLineDraft[];
  ingredients: IngredientOption[];
  canWrite: boolean;
  onUpdateLine: (key: string, patch: Partial<RecipeLineDraft>) => void;
  onRemoveLine: (key: string) => void;
  onAddLine: () => void;
}) {
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));
  const usedIngredientIds = new Set(lines.map((l) => l.ingredientId).filter(Boolean));

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Scrolls on its own on a narrow viewport instead of the table
          squeezing its columns (or the page/modal gaining body scroll) —
          this table has more columns than a phone-width container can
          comfortably show at once. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Ingredient</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">Waste %</th>
              <th className="px-4 py-3">Line cost</th>
              {canWrite ? <th className="px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-text-secondary)]">
                  No ingredients in this recipe yet.
                </td>
              </tr>
            ) : (
              lines.map((line) => {
                const ing = ingredientById.get(line.ingredientId);
                const lineCost = ing
                  ? calculateRecipeLineCost({
                      ingredientId: line.ingredientId,
                      quantityBaseUnits: line.quantityBaseUnits,
                      wastePercentage: line.wastePercentage,
                      costPerBaseUnit: ing.costPerBaseUnit,
                    }).lineCostRupiah
                  : 0;

                return (
                  <tr key={line.key} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2">
                      <Select
                        value={line.ingredientId}
                        disabled={!canWrite}
                        onChange={(value) => onUpdateLine(line.key, { ingredientId: value })}
                      >
                        <option value="">Select ingredient…</option>
                        {ingredients
                          .filter((i) => i.id === line.ingredientId || !usedIngredientIds.has(i.id))
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                      </Select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          disabled={!canWrite}
                          value={line.quantityBaseUnits || ""}
                          onChange={(e) => onUpdateLine(line.key, { quantityBaseUnits: Number(e.target.value) })}
                          className={inputClassName + " w-24"}
                        />
                        <span className="text-xs text-[var(--color-text-muted)]">{ing ? UNIT_LABEL[ing.baseUnit] : ""}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        disabled={!canWrite}
                        value={line.wastePercentage || ""}
                        onChange={(e) => onUpdateLine(line.key, { wastePercentage: Number(e.target.value) })}
                        className={inputClassName + " w-20"}
                      />
                    </td>
                    <td className="px-4 py-2 tabular-nums text-[var(--color-text-secondary)]">{formatIDR(lineCost)}</td>
                    {canWrite ? (
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onRemoveLine(line.key)}
                          aria-label="Remove line"
                          className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-danger)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {canWrite ? (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <button
            type="button"
            onClick={onAddLine}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-accent-primary)] hover:underline"
          >
            <Plus size={14} />
            Add ingredient
          </button>
        </div>
      ) : null}
    </div>
  );
}
