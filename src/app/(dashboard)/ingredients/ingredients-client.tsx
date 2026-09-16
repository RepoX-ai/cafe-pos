"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import { formatIDRRate, formatIDRRatePerPurchaseUnit } from "@/lib/money/money";
import {
  baseToDisplayQuantity,
  baseUnitOfDisplayUnit,
  DISPLAY_UNIT_OPTIONS,
  displayToBaseQuantity,
  displayUnitsFor,
  formatDisplayQuantity,
  purchaseScaleFor,
  resolveDisplayUnit,
  type DisplayUnit,
} from "@/lib/units/units";
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
  displayUnit: DisplayUnit | null;
  currentQuantityBaseUnits: string;
  reorderLevelBaseUnits: string | null;
  targetStockBaseUnits: string | null;
  averageCostPerBaseUnit: string;
  /** Any purchase, count, sale or waste recorded — cost is then owned by purchases. */
  hasStockHistory: boolean;
  active: boolean;
  notes: string | null;
}

/** A typed display-unit amount as a base-unit string, or "" when blank or not a number. */
function toBaseOrBlank(value: string, unit: DisplayUnit): string {
  if (value.trim() === "") return "";
  try {
    return displayToBaseQuantity(value, unit);
  } catch {
    return "";
  }
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
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Avg. cost</th>
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
                  <td className="px-4 py-3 tabular-nums">
                    <div className="flex items-center gap-2">
                      <span>{formatDisplayQuantity(ing.currentQuantityBaseUnits, resolveDisplayUnit(ing.baseUnit, ing.displayUnit))}</span>
                      {lowStockIds.has(ing.id) ? <Badge tone="warning">Low stock</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatIDRRatePerPurchaseUnit(ing.averageCostPerBaseUnit, ing.baseUnit)}</td>
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
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>(
    existing ? resolveDisplayUnit(existing.baseUnit, existing.displayUnit) : "g",
  );
  const baseUnit = baseUnitOfDisplayUnit(displayUnit);
  // Once created the class is fixed (every stored quantity is in it), so
  // edit only offers the other unit of the same class: kg <-> g, L <-> ml.
  const unitOptions = existing
    ? DISPLAY_UNIT_OPTIONS.filter((o) => displayUnitsFor(existing.baseUnit).includes(o.value))
    : DISPLAY_UNIT_OPTIONS;
  // Reorder level and target stock are typed in the display unit and
  // submitted as base units through the hidden inputs below.
  const [reorderLevel, setReorderLevel] = useState(
    existing?.reorderLevelBaseUnits ? baseToDisplayQuantity(existing.reorderLevelBaseUnits, displayUnit) : "",
  );
  const [targetStock, setTargetStock] = useState(
    existing?.targetStockBaseUnits ? baseToDisplayQuantity(existing.targetStockBaseUnits, displayUnit) : "",
  );

  function changeDisplayUnit(next: DisplayUnit) {
    // Keep the same physical amount: 0,5 kg becomes 500 g, not 0,5 g.
    const convert = (value: string) => {
      const base = toBaseOrBlank(value, displayUnit);
      return base === "" ? value : baseToDisplayQuantity(base, next);
    };
    setReorderLevel(convert);
    setTargetStock(convert);
    setDisplayUnit(next);
  }

  const reorderLevelBase = toBaseOrBlank(reorderLevel, displayUnit);
  const targetStockBase = toBaseOrBlank(targetStock, displayUnit);
  const showsBaseEquivalent = displayUnit === "kg" || displayUnit === "L";
  const smallUnit = resolveDisplayUnit(baseUnit, null);
  const scale = purchaseScaleFor(baseUnit);
  // Shown and entered per kg / L / pc, like the Avg. cost column. On edit
  // it's prefilled from the stored per-base-unit rate, and only submitted
  // if changed, so saving a name edit never rewrites the cost.
  const initialCost = existing ? String(Math.round(Number(existing.averageCostPerBaseUnit) * scale.baseUnitsPer)) : "";
  const [startingCost, setStartingCost] = useState(initialCost);
  const costEditable = !existing || !existing.hasStockHistory;
  const startingCostNumber = Number(startingCost);

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

      <Field
        label="Unit"
        htmlFor="displayUnit"
        hint={
          existing
            ? unitOptions.length > 1
              ? "Changes how stock is shown and entered. It can't switch to a different kind of unit."
              : "Counted in pieces."
            : "How stock is shown and entered. You can switch between kg and g (or L and ml) later."
        }
        error={errorState?.fieldErrors?.displayUnit ?? errorState?.fieldErrors?.baseUnit}
      >
        <Select
          id="displayUnit"
          name="displayUnit"
          value={displayUnit}
          onChange={(value) => changeDisplayUnit(value as DisplayUnit)}
          disabled={unitOptions.length < 2}
        >
          {unitOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {!existing ? <input type="hidden" name="baseUnit" value={baseUnit} /> : null}
      </Field>

      {costEditable ? (
        <Field
          label={`${existing ? "Estimated cost" : "Starting cost"} per ${scale.label} (Rp)`}
          htmlFor="startingCostPerPurchaseUnit"
          hint={
            startingCost !== "" && Number.isFinite(startingCostNumber) && startingCostNumber > 0 && baseUnit !== "piece"
              ? `= ${formatIDRRate(startingCostNumber / scale.baseUnitsPer)} per ${baseUnit}. Optional — purchases recalculate it from what you actually paid.`
              : "Optional. An estimate so recipes show a cost before you've recorded a purchase — purchases recalculate it from what you actually paid."
          }
          error={errorState?.fieldErrors?.startingCostPerPurchaseUnit}
        >
          <input
            id="startingCostPerPurchaseUnit"
            name={startingCost !== initialCost ? "startingCostPerPurchaseUnit" : undefined}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder={baseUnit === "piece" ? "e.g. 2500" : "e.g. 45000"}
            value={startingCost}
            onChange={(e) => setStartingCost(e.target.value)}
            className={inputClassName}
          />
        </Field>
      ) : (
        <Field label={`Average cost per ${scale.label}`} htmlFor="averageCostReadonly">
          <p id="averageCostReadonly" className="text-sm tabular-nums text-[var(--color-text-primary)]">
            {formatIDRRatePerPurchaseUnit(existing!.averageCostPerBaseUnit, baseUnit)}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            Calculated from recorded purchases, so it can&apos;t be typed in.
          </p>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field
          label={`Reorder level (${displayUnit})`}
          htmlFor="reorderLevel"
          hint={
            showsBaseEquivalent && reorderLevelBase
              ? `= ${formatDisplayQuantity(reorderLevelBase, smallUnit)}. Warn when stock falls to/below this`
              : "Warn when stock falls to/below this"
          }
          error={errorState?.fieldErrors?.reorderLevelBaseUnits}
        >
          <input
            id="reorderLevel"
            type="number"
            min={0}
            step="any"
            value={reorderLevel}
            onChange={(e) => setReorderLevel(e.target.value)}
            className={inputClassName}
          />
          <input type="hidden" name="reorderLevelBaseUnits" value={reorderLevelBase} />
        </Field>
        <Field
          label={`Target stock (${displayUnit})`}
          htmlFor="targetStock"
          hint={
            showsBaseEquivalent && targetStockBase
              ? `= ${formatDisplayQuantity(targetStockBase, smallUnit)}. Optional restock target`
              : "Optional restock target"
          }
          error={errorState?.fieldErrors?.targetStockBaseUnits}
        >
          <input
            id="targetStock"
            type="number"
            min={0}
            step="any"
            value={targetStock}
            onChange={(e) => setTargetStock(e.target.value)}
            className={inputClassName}
          />
          <input type="hidden" name="targetStockBaseUnits" value={targetStockBase} />
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
