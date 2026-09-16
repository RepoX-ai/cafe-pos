"use client";

import { formatIDR } from "@/lib/money/money";
import { useEffect, useState, useTransition } from "react";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import {
  createModifierGroupAction,
  createModifierOptionAction,
  deleteModifierGroupAction,
  deleteModifierOptionAction,
  setModifierGroupActiveAction,
  saveModifierOptionRecipeAction,
  setModifierOptionActiveAction,
  type FormActionState,
} from "./actions";
import { calculateRecipeCost } from "@/lib/recipes/cost";
import { useToast } from "@/components/ui/toast";
import {
  newRecipeLineKey,
  RecipeLinesTable,
  type IngredientOption,
  type RecipeLineDraft,
} from "./recipe-lines-table";
import { ActionMenu } from "@/components/ui/action-menu";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { formDataOf, useToastAction } from "@/components/ui/use-toast-action";
import { useActionResultToast } from "@/components/ui/use-action-toast";
import type { ModifierGroupRow, ModifierOptionRow } from "./menu-types";

export function ModifiersTab({
  groups,
  ingredients,
  canWrite,
  canWriteRecipes,
}: {
  groups: ModifierGroupRow[];
  ingredients: IngredientOption[];
  canWrite: boolean;
  canWriteRecipes: boolean;
}) {
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [addingOptionTo, setAddingOptionTo] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<{ groupId: string; option: ModifierOptionRow } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreatingGroup(true)}>
            <Plus size={16} />
            New modifier group
          </Button>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
          No modifier groups yet — e.g. &quot;Sweetness&quot; or &quot;Milk choice&quot;.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[var(--color-text-primary)]">{group.name}</span>
                {group.required ? <Badge tone="accent">Required</Badge> : null}
                <Badge tone={group.active ? "success" : "neutral"}>{group.active ? "Active" : "Archived"}</Badge>
                <span className="text-xs text-[var(--color-text-muted)]">
                  select {group.minSelections}–{group.maxSelections}
                </span>
              </div>
              {canWrite ? (
                <ModifierGroupActions group={group} onAddOption={() => setAddingOptionTo(group.id)} />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {group.options.length === 0 ? (
                <span className="text-sm text-[var(--color-text-muted)]">No options yet.</span>
              ) : (
                group.options.map((opt) => (
                  <span
                    key={opt.id}
                    className={`inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs ${
                      opt.active ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] line-through"
                    }`}
                  >
                    {opt.name}
                    {opt.priceAdjustment !== 0 ? (
                      <span className="tabular-nums text-[var(--color-text-secondary)]">
                        {opt.priceAdjustment > 0 ? "+" : ""}
                        {formatIDR(opt.priceAdjustment)}
                      </span>
                    ) : null}
                    <span className="tabular-nums text-[var(--color-text-muted)]">
                      {opt.recipeLines.length > 0 ? `· COGS ${formatIDR(opt.cogs)}` : "· No recipe"}
                    </span>
                    {canWrite || canWriteRecipes ? (
                      <ModifierOptionActions
                        groupId={group.id}
                        option={opt}
                        canWrite={canWrite}
                        onEditRecipe={canWriteRecipes ? () => setEditingRecipe({ groupId: group.id, option: opt }) : undefined}
                      />
                    ) : null}
                  </span>
                ))
              )}
            </div>
          </div>
        ))
      )}

      <Modal open={creatingGroup} onClose={() => setCreatingGroup(false)} title="New modifier group">
        <ModifierGroupForm onDone={() => setCreatingGroup(false)} />
      </Modal>

      <Modal
        open={editingRecipe !== null}
        onClose={() => setEditingRecipe(null)}
        title={editingRecipe ? `Recipe — ${editingRecipe.option.name}` : "Recipe"}
        description="Ingredients deducted from stock each time this option is sold, on top of the item's own recipe."
        maxWidthClassName="max-w-[640px]"
      >
        {editingRecipe ? (
          <ModifierRecipeForm
            key={editingRecipe.option.id}
            groupId={editingRecipe.groupId}
            option={editingRecipe.option}
            ingredients={ingredients}
            onDone={() => setEditingRecipe(null)}
          />
        ) : null}
      </Modal>

      <Modal open={addingOptionTo !== null} onClose={() => setAddingOptionTo(null)} title="New modifier option">
        {addingOptionTo ? (
          <ModifierOptionForm groupId={addingOptionTo} onDone={() => setAddingOptionTo(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

function ModifierGroupForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<FormActionState, FormData>(createModifierGroupAction, undefined);
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Modifier group created.");

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="name" error={errorState?.fieldErrors?.name}>
        <input id="name" name="name" required placeholder="e.g. Sweetness" className={inputClassName} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Min selections" htmlFor="minSelections">
          <input id="minSelections" name="minSelections" type="number" min={0} defaultValue={0} className={inputClassName} />
        </Field>
        <Field label="Max selections" htmlFor="maxSelections">
          <input id="maxSelections" name="maxSelections" type="number" min={1} defaultValue={1} className={inputClassName} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
        <Checkbox name="required" />
        Required (customer must choose)
      </label>
      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState.error}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Create group"}
        </Button>
      </div>
    </form>
  );
}

function ModifierOptionForm({ groupId, onDone }: { groupId: string; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<FormActionState, FormData>(createModifierOptionAction, undefined);
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Option added.");

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="groupId" value={groupId} />
      <Field label="Name" htmlFor="name" error={errorState?.fieldErrors?.name}>
        <input id="name" name="name" required placeholder="e.g. Extra sweet" className={inputClassName} />
      </Field>
      <Field label="Price adjustment (Rp)" htmlFor="priceAdjustment" hint="Negative for a discount, 0 for no charge">
        <input id="priceAdjustment" name="priceAdjustment" type="number" defaultValue={0} className={inputClassName} />
      </Field>
      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState.error}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Add option"}
        </Button>
      </div>
    </form>
  );
}

function ModifierGroupActions({
  group,
  onAddOption,
}: {
  group: ModifierGroupRow;
  onAddOption: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const { run, isPending } = useToastAction();

  return (
    <>
      <ActionMenu
        label={`Actions for ${group.name}`}
        items={[
          { label: "Add option", onSelect: onAddOption, disabled: isPending },
          {
            label: group.active ? "Archive" : "Restore",
            onSelect: () =>
              run(
                () => setModifierGroupActiveAction(formDataOf({ id: group.id, active: (!group.active).toString() })),
                { success: group.active ? "Modifier group archived." : "Modifier group restored." },
              ),
            disabled: isPending,
          },
          { label: "Delete permanently", onSelect: () => setDeleting(true), tone: "danger", disabled: isPending },
        ]}
      />
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        action={deleteModifierGroupAction}
        fields={{ id: group.id }}
        title={`Delete "${group.name}"?`}
        successMessage={`"${group.name}" deleted.`}
        description={
          <>
            This removes the group, all of its options, and their ingredient lines for good, and
            detaches it from every menu item using it. It can&rsquo;t be undone.
            <br />
            <br />
            Past orders are unaffected — they keep their own record of which modifiers were chosen
            and what they cost.
          </>
        }
      />
    </>
  );
}

function ModifierRecipeForm({
  groupId,
  option,
  ingredients,
  onDone,
}: {
  groupId: string;
  option: ModifierOptionRow;
  ingredients: IngredientOption[];
  onDone: () => void;
}) {
  const [lines, setLines] = useState<RecipeLineDraft[]>(() =>
    option.recipeLines.map((l) => ({ ...l, notes: "", key: newRecipeLineKey() })),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const showToast = useToast();

  const costById = new Map(ingredients.map((i) => [i.id, i.costPerBaseUnit]));
  const totalCost = calculateRecipeCost(
    lines
      .filter((l) => l.ingredientId && l.quantityBaseUnits > 0)
      .map((l) => ({ ...l, costPerBaseUnit: costById.get(l.ingredientId) ?? "0" })),
  );

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveModifierOptionRecipeAction({
        groupId,
        optionId: option.id,
        lines: lines
          .filter((l) => l.ingredientId)
          .map((l) => ({ ingredientId: l.ingredientId, quantityBaseUnits: l.quantityBaseUnits, wastePercentage: l.wastePercentage })),
      });
      if (result.ok) {
        showToast("success", "Recipe saved.");
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <RecipeLinesTable
        lines={lines}
        ingredients={ingredients}
        canWrite
        onUpdateLine={(key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))}
        onRemoveLine={(key) => setLines((prev) => prev.filter((l) => l.key !== key))}
        onAddLine={() =>
          setLines((prev) => [...prev, { key: newRecipeLineKey(), ingredientId: "", quantityBaseUnits: 0, wastePercentage: 0, notes: "" }])
        }
      />
      <dl className="grid grid-cols-2 gap-4 rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 text-sm">
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Price adjustment</dt>
          <dd className="mt-1 font-medium tabular-nums text-[var(--color-text-primary)]">{formatIDR(option.priceAdjustment)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Recipe cost (COGS)</dt>
          <dd className="mt-1 font-medium tabular-nums text-[var(--color-text-primary)]">{formatIDR(totalCost)}</dd>
        </div>
      </dl>
      {error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={isPending}>
          {isPending ? "Saving…" : "Save recipe"}
        </Button>
      </div>
    </div>
  );
}

function ModifierOptionActions({
  groupId,
  option,
  canWrite,
  onEditRecipe,
}: {
  groupId: string;
  option: ModifierOptionRow;
  canWrite: boolean;
  onEditRecipe?: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const { run, isPending } = useToastAction();

  return (
    <>
      <ActionMenu
        size="sm"
        label={`Actions for ${option.name}`}
        items={[
          ...(onEditRecipe ? [{ label: option.recipeLines.length > 0 ? "Edit recipe" : "Add recipe", onSelect: onEditRecipe }] : []),
          ...(canWrite ? [
          {
            label: option.active ? "Archive" : "Restore",
            onSelect: () =>
              run(
                () =>
                  setModifierOptionActiveAction(
                    formDataOf({ groupId, optionId: option.id, active: (!option.active).toString() }),
                  ),
                { success: option.active ? "Option archived." : "Option restored." },
              ),
            disabled: isPending,
          },
          { label: "Delete permanently", onSelect: () => setDeleting(true), tone: "danger" as const, disabled: isPending },
          ] : []),
        ]}
      />
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        action={deleteModifierOptionAction}
        fields={{ groupId, optionId: option.id }}
        title={`Delete "${option.name}"?`}
        successMessage={`"${option.name}" deleted.`}
        description={
          <>
            This removes the option and its ingredient lines for good. It can&rsquo;t be undone.
            <br />
            <br />
            Past orders are unaffected — they keep their own record of the modifiers chosen and what
            they cost.
          </>
        }
      />
    </>
  );
}
