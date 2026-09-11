"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClassName, selectClassName } from "@/components/ui/form-field";
import { calculateRecipeCost, calculateRecipeLineCost } from "@/lib/recipes/cost";
import { formatIDR, grossMarginPercentage } from "@/lib/money/money";
import { saveRecipeAction } from "./actions";

interface IngredientOption {
  id: string;
  name: string;
  baseUnit: "gram" | "millilitre" | "piece";
  costPerBaseUnit: string;
}

interface Line {
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
function newKey() {
  keySeq += 1;
  return `line-${keySeq}`;
}

export function RecipeEditor({
  menuItemId,
  variantId,
  variantName,
  variantPrice,
  ingredients,
  initialLines,
  canWrite,
}: {
  menuItemId: string;
  variantId: string;
  variantName: string;
  variantPrice: number;
  ingredients: IngredientOption[];
  initialLines: Array<Omit<Line, "key">>;
  canWrite: boolean;
}) {
  const [lines, setLines] = useState<Line[]>(
    initialLines.length > 0
      ? initialLines.map((l) => ({ ...l, key: newKey() }))
      : [],
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const costLines = lines
    .filter((l) => l.ingredientId && l.quantityBaseUnits > 0)
    .map((l) => {
      const ing = ingredientById.get(l.ingredientId);
      return {
        ingredientId: l.ingredientId,
        quantityBaseUnits: l.quantityBaseUnits,
        wastePercentage: l.wastePercentage,
        costPerBaseUnit: ing?.costPerBaseUnit ?? "0",
      };
    });

  const totalCost = calculateRecipeCost(costLines);
  const grossProfit = variantPrice - totalCost;
  const margin = grossMarginPercentage(grossProfit, variantPrice);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function addLine() {
    setLines((prev) => [...prev, { key: newKey(), ingredientId: "", quantityBaseUnits: 0, wastePercentage: 0, notes: "" }]);
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveRecipeAction(menuItemId, {
        menuItemVariantId: variantId,
        lines: lines
          .filter((l) => l.ingredientId)
          .map((l) => ({
            ingredientId: l.ingredientId,
            quantityBaseUnits: l.quantityBaseUnits,
            wastePercentage: l.wastePercentage,
            notes: l.notes,
          })),
      });
      setMessage(result.ok ? { ok: true, text: "Recipe saved." } : { ok: false, text: result.error });
    });
  }

  const usedIngredientIds = new Set(lines.map((l) => l.ingredientId).filter(Boolean));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Ingredient</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">Waste %</th>
              <th className="px-4 py-3 text-right">Line cost</th>
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
                      <select
                        value={line.ingredientId}
                        disabled={!canWrite}
                        onChange={(e) => updateLine(line.key, { ingredientId: e.target.value })}
                        className={selectClassName + " w-full"}
                      >
                        <option value="">Select ingredient…</option>
                        {ingredients
                          .filter((i) => i.id === line.ingredientId || !usedIngredientIds.has(i.id))
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          disabled={!canWrite}
                          value={line.quantityBaseUnits || ""}
                          onChange={(e) => updateLine(line.key, { quantityBaseUnits: Number(e.target.value) })}
                          className={inputClassName + " w-24"}
                        />
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {ing ? UNIT_LABEL[ing.baseUnit] : ""}
                        </span>
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
                        onChange={(e) => updateLine(line.key, { wastePercentage: Number(e.target.value) })}
                        className={inputClassName + " w-20"}
                      />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">
                      {formatIDR(lineCost)}
                    </td>
                    {canWrite ? (
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => removeLine(line.key)}
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
        {canWrite ? (
          <div className="border-t border-[var(--color-border)] px-4 py-3">
            <button
              onClick={addLine}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-accent-primary)] hover:underline"
            >
              <Plus size={14} />
              Add ingredient
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <MetricCard label={`${variantName} price`} value={formatIDR(variantPrice)} />
        <MetricCard label="Recipe cost (COGS)" value={formatIDR(totalCost)} />
        <MetricCard
          label="Gross margin"
          value={margin === null ? "—" : `${margin.toFixed(1)}%`}
          sub={formatIDR(grossProfit)}
          tone={grossProfit < 0 ? "danger" : "default"}
        />
      </div>

      {message ? (
        <p
          role="status"
          className={`rounded-[var(--radius-sm)] px-3 py-2 text-sm ${
            message.ok ? "bg-[#E7F8EF] text-[var(--color-success)]" : "bg-[#FEF3F2] text-[var(--color-danger)]"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {canWrite ? (
        <div className="flex justify-end">
          <Button onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save recipe"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--color-text-primary)]"}`}>
        {value}
      </p>
      {sub ? <p className="text-xs tabular-nums text-[var(--color-text-muted)]">{sub}</p> : null}
    </div>
  );
}
