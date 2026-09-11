"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, inputClassName, selectClassName, textareaClassName } from "@/components/ui/form-field";
import {
  createIngredientAction,
  setIngredientActiveAction,
  updateIngredientAction,
  type IngredientFormState,
} from "./actions";

type BaseUnit = "gram" | "millilitre" | "piece";

export interface IngredientRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  baseUnit: BaseUnit;
  currentQuantityBaseUnits: string;
  reorderLevelBaseUnits: string | null;
  averageCostPerBaseUnit: string;
  active: boolean;
  notes: string | null;
}

const UNIT_LABEL: Record<BaseUnit, string> = { gram: "g", millilitre: "ml", piece: "pc" };

function formatQuantity(value: string | null, unit: BaseUnit) {
  if (value === null) return "—";
  const num = Number(value);
  return `${num.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${UNIT_LABEL[unit]}`;
}

function formatCost(value: string) {
  const num = Number(value);
  return `Rp${num.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
}

export function IngredientsClient({
  ingredients,
  canWrite,
}: {
  ingredients: IngredientRow[];
  canWrite: boolean;
}) {
  const [drawerState, setDrawerState] = useState<{ mode: "create" } | { mode: "edit"; row: IngredientRow } | null>(
    null,
  );

  const lowStockIds = useMemo(() => {
    const set = new Set<string>();
    for (const ing of ingredients) {
      if (!ing.reorderLevelBaseUnits) continue;
      if (Number(ing.currentQuantityBaseUnits) <= Number(ing.reorderLevelBaseUnits)) {
        set.add(ing.id);
      }
    }
    return set;
  }, [ingredients]);

  return (
    <div>
      {canWrite ? (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setDrawerState({ mode: "create" })}>
            <Plus size={16} />
            New ingredient
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3 text-right">Stock</th>
              <th className="px-4 py-3 text-right">Avg. cost / unit</th>
              <th className="px-4 py-3">Status</th>
              {canWrite ? <th className="px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {ingredients.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                  No ingredients yet.{canWrite ? " Add your first one to start building recipes." : ""}
                </td>
              </tr>
            ) : (
              ingredients.map((ing) => (
                <tr key={ing.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--color-text-primary)]">{ing.name}</div>
                    {ing.sku ? (
                      <div className="font-mono text-xs text-[var(--color-text-muted)]">{ing.sku}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{ing.category || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatQuantity(ing.currentQuantityBaseUnits, ing.baseUnit)}
                    {lowStockIds.has(ing.id) ? (
                      <div>
                        <Badge tone="warning">Low stock</Badge>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCost(ing.averageCostPerBaseUnit)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={ing.active ? "success" : "neutral"}>
                      {ing.active ? "Active" : "Archived"}
                    </Badge>
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setDrawerState({ mode: "edit", row: ing })}
                          className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
                          aria-label={`Edit ${ing.name}`}
                        >
                          <Pencil size={15} />
                        </button>
                        <form action={setIngredientActiveAction}>
                          <input type="hidden" name="id" value={ing.id} />
                          <input type="hidden" name="active" value={(!ing.active).toString()} />
                          <button
                            type="submit"
                            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)]"
                          >
                            {ing.active ? "Archive" : "Restore"}
                          </button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Drawer
        open={drawerState !== null}
        onClose={() => setDrawerState(null)}
        title={drawerState?.mode === "edit" ? "Edit ingredient" : "New ingredient"}
        description="Quantities are in the ingredient's base unit."
      >
        {drawerState ? (
          <IngredientForm
            key={drawerState.mode === "edit" ? drawerState.row.id : "create"}
            existing={drawerState.mode === "edit" ? drawerState.row : null}
            onDone={() => setDrawerState(null)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function IngredientForm({ existing, onDone }: { existing: IngredientRow | null; onDone: () => void }) {
  const action = existing ? updateIngredientAction : createIngredientAction;
  const [state, formAction, isPending] = useActionState<IngredientFormState, FormData>(action, undefined);

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const errorState = state && !state.ok ? state : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {existing ? <input type="hidden" name="id" value={existing.id} /> : null}

      <Field label="Name" htmlFor="name" error={errorState?.fieldErrors?.name}>
        <input
          id="name"
          name="name"
          defaultValue={existing?.name}
          required
          className={inputClassName}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="SKU" htmlFor="sku" error={errorState?.fieldErrors?.sku}>
          <input id="sku" name="sku" defaultValue={existing?.sku ?? ""} className={inputClassName} />
        </Field>
        <Field label="Category" htmlFor="category" error={errorState?.fieldErrors?.category}>
          <input
            id="category"
            name="category"
            defaultValue={existing?.category ?? ""}
            className={inputClassName}
          />
        </Field>
      </div>

      <Field label="Base unit" htmlFor="baseUnit" error={errorState?.fieldErrors?.baseUnit}>
        <select
          id="baseUnit"
          name="baseUnit"
          defaultValue={existing?.baseUnit ?? "gram"}
          disabled={!!existing}
          className={selectClassName}
        >
          <option value="gram">Gram (weight)</option>
          <option value="millilitre">Millilitre (volume)</option>
          <option value="piece">Piece (countable)</option>
        </select>
        {existing ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Base unit can&apos;t change once movements exist against it.
          </p>
        ) : null}
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Reorder level"
          htmlFor="reorderLevelBaseUnits"
          hint="Warn when stock falls to/below this"
          error={errorState?.fieldErrors?.reorderLevelBaseUnits}
        >
          <input
            id="reorderLevelBaseUnits"
            name="reorderLevelBaseUnits"
            type="number"
            min={0}
            step="any"
            defaultValue={existing?.reorderLevelBaseUnits ?? ""}
            className={inputClassName}
          />
        </Field>
        <Field
          label="Target stock"
          htmlFor="targetStockBaseUnits"
          hint="Optional restock target"
          error={errorState?.fieldErrors?.targetStockBaseUnits}
        >
          <input
            id="targetStockBaseUnits"
            name="targetStockBaseUnits"
            type="number"
            min={0}
            step="any"
            className={inputClassName}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={errorState?.fieldErrors?.notes}>
        <textarea id="notes" name="notes" defaultValue={existing?.notes ?? ""} className={textareaClassName} />
      </Field>

      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState!.error}
        </p>
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : existing ? "Save changes" : "Create ingredient"}
        </Button>
      </div>
    </form>
  );
}
