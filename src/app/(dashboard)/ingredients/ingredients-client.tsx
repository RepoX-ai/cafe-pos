"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import { formatIDRRate } from "@/lib/money/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName, textareaClassName } from "@/components/ui/form-styles";
import { Pagination } from "@/components/ui/pagination";
import { usePagination } from "@/components/ui/use-pagination";
import {
  createIngredientAction,
  deleteIngredientAction,
  setIngredientActiveAction,
  updateIngredientAction,
  type IngredientFormState,
} from "./actions";
import { ActionMenu } from "@/components/ui/action-menu";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { formDataOf, useToastAction } from "@/components/ui/use-toast-action";
import { useActionResultToast } from "@/components/ui/use-action-toast";

type BaseUnit = "gram" | "millilitre" | "piece";

export interface IngredientRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  baseUnit: BaseUnit;
  currentQuantityBaseUnits: string;
  reorderLevelBaseUnits: string | null;
  targetStockBaseUnits: string | null;
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


export function IngredientsClient({
  ingredients,
  recipeUsage,
  canWrite,
}: {
  ingredients: IngredientRow[];
  /** Recipe lines each ingredient still appears in, keyed by ingredient id. */
  recipeUsage: Record<string, number>;
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

  const { page, setPage, totalPages, pageItems, pageSize, totalItems } = usePagination(ingredients, 20);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Ingredients</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Base-unit stock, cost, and reorder thresholds for every ingredient.
          </p>
        </div>
        {canWrite ? (
          <Button onClick={() => setDrawerState({ mode: "create" })}>
            <Plus size={16} />
            New ingredient
          </Button>
        ) : null}
      </div>

      <div className="mt-8 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
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
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                  No ingredients yet.{canWrite ? " Add your first one to start building recipes." : ""}
                </td>
              </tr>
            ) : (
              pageItems.map((ing) => (
                <tr key={ing.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--color-text-primary)]">{ing.name}</div>
                    {ing.sku ? (
                      <div className="text-xs text-[var(--color-text-muted)]">{ing.sku}</div>
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
                  <td className="px-4 py-3 text-right tabular-nums">{formatIDRRate(ing.averageCostPerBaseUnit)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={ing.active ? "success" : "neutral"}>
                      {ing.active ? "Active" : "Archived"}
                    </Badge>
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <IngredientRowActions
                          ingredient={ing}
                          recipeUsage={recipeUsage[ing.id] ?? 0}
                          onEdit={() => setDrawerState({ mode: "edit", row: ing })}
                        />
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        <Pagination page={page} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />
      </div>

      <Modal
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
      </Modal>
    </div>
  );
}

function IngredientForm({ existing, onDone }: { existing: IngredientRow | null; onDone: () => void }) {
  const action = existing ? updateIngredientAction : createIngredientAction;
  const [state, formAction, isPending] = useActionState<IngredientFormState, FormData>(action, undefined);
  useActionResultToast(state, existing ? "Ingredient saved." : "Ingredient created.");

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
        <Select id="baseUnit" name="baseUnit" defaultValue={existing?.baseUnit ?? "gram"} disabled={!!existing}>
          <option value="gram">Gram (weight)</option>
          <option value="millilitre">Millilitre (volume)</option>
          <option value="piece">Piece (countable)</option>
        </Select>
        {existing ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Base unit can&apos;t change once movements exist against it.
          </p>
        ) : null}
      </Field>

      {!existing ? (
        <Field
          label="Starting cost / unit"
          htmlFor="startingCostPerBaseUnit"
          hint="Optional. Lets you cost recipes before the first purchase — the next purchase recalculates the average as usual."
          error={errorState?.fieldErrors?.startingCostPerBaseUnit}
        >
          <input
            id="startingCostPerBaseUnit"
            name="startingCostPerBaseUnit"
            type="number"
            min={0}
            step="any"
            placeholder="0"
            className={inputClassName}
          />
        </Field>
      ) : null}

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
            defaultValue={existing?.reorderLevelBaseUnits ? Number(existing.reorderLevelBaseUnits) : ""}
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
            defaultValue={existing?.targetStockBaseUnits ? Number(existing.targetStockBaseUnits) : ""}
            className={inputClassName}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={errorState?.fieldErrors?.notes}>
        <textarea id="notes" name="notes" defaultValue={existing?.notes ?? ""} className={textareaClassName} />
      </Field>

      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
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

/**
 * Per-row actions live behind the shared "…" menu, the same affordance
 * every other table in the dashboard uses. The confirm dialog is a sibling
 * of the menu rather than something the menu renders: menu items are
 * callbacks, and the menu closes the moment one fires.
 */
function IngredientRowActions({
  ingredient,
  recipeUsage,
  onEdit,
}: {
  ingredient: IngredientRow;
  recipeUsage: number;
  onEdit: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const { run, isPending } = useToastAction();

  return (
    <>
      <ActionMenu
        label={`Actions for ${ingredient.name}`}
        items={[
          { label: "Edit details", onSelect: onEdit, disabled: isPending },
          {
            label: ingredient.active ? "Archive" : "Restore",
            onSelect: () =>
              run(
                () =>
                  setIngredientActiveAction(
                    formDataOf({ id: ingredient.id, active: (!ingredient.active).toString() }),
                  ),
                { success: ingredient.active ? "Ingredient archived." : "Ingredient restored." },
              ),
            disabled: isPending,
          },
          {
            label: "Delete permanently",
            onSelect: () => setDeleting(true),
            tone: "danger",
            disabled: isPending,
          },
        ]}
      />

      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        action={deleteIngredientAction}
        fields={{ id: ingredient.id }}
        title={`Delete "${ingredient.name}"?`}
        successMessage={`"${ingredient.name}" deleted.`}
        description={
          <>
            This removes the ingredient for good. It can&rsquo;t be undone.
            {recipeUsage > 0 ? (
              <>
                {" "}
                It is used in{" "}
                <strong className="text-[var(--color-text-primary)]">
                  {recipeUsage} recipe{recipeUsage === 1 ? "" : "s"}
                </strong>
                , and will be dropped from {recipeUsage === 1 ? "it" : "them"} — those items will
                cost less to make from now on.
              </>
            ) : null}
            <br />
            <br />
            Stock and cost history is unaffected: the ledger, past purchases, waste records and the
            COGS behind every past order all keep their own record of this ingredient.
          </>
        }
      />
    </>
  );
}
