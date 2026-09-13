"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { calculateRecipeCost } from "@/lib/recipes/cost";
import { formatIDR, grossMarginPercentage } from "@/lib/money/money";
import { newRecipeLineKey as newKey, RecipeLinesTable, type IngredientOption, type RecipeLineDraft as Line } from "../../recipe-lines-table";
import { saveRecipeAction } from "./actions";
import { useToast } from "@/components/ui/toast";

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
  const showToast = useToast();

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
      if (result.ok) {
        showToast("success", "Recipe saved.");
        setMessage(null);
      } else {
        setMessage({ ok: false, text: result.error });
        showToast("error", result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <RecipeLinesTable
        lines={lines}
        ingredients={ingredients}
        canWrite={canWrite}
        onUpdateLine={updateLine}
        onRemoveLine={removeLine}
        onAddLine={addLine}
      />

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
            message.ok ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
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
