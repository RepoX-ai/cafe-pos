"use client";

import { formatIDR } from "@/lib/money/money";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, ChefHat, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName, textareaClassName } from "@/components/ui/form-styles";
import {
  createVariantWithRecipeAction,
  setItemModifierGroupsAction,
  setVariantActiveAction,
  updateMenuItemAction,
  updateVariantAction,
  type FormActionState,
} from "../actions";
import { ImageField } from "../image-field";
import { newRecipeLineKey, RecipeLinesTable, type IngredientOption, type RecipeLineDraft } from "../recipe-lines-table";
import { ToastForm } from "@/components/ui/toast-form";
import { useToast } from "@/components/ui/toast";
import { useActionResultToast } from "@/components/ui/use-action-toast";
import { unstable_rethrow } from "next/navigation";

interface Item {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  basePrice: number;
  taxBehavior: string;
  active: boolean;
  tracksInventory: boolean;
  displayOrder: number;
}

interface Variant {
  id: string;
  name: string;
  price: number;
  active: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface ModifierGroup {
  id: string;
  name: string;
  active: boolean;
}

export function ItemDetailClient({
  item,
  variants,
  assignedModifierGroupIds,
  categories,
  modifierGroups,
  ingredients,
  canWrite,
  canWriteRecipe,
}: {
  item: Item;
  variants: Variant[];
  assignedModifierGroupIds: string[];
  categories: Category[];
  modifierGroups: ModifierGroup[];
  ingredients: IngredientOption[];
  canWrite: boolean;
  canWriteRecipe: boolean;
}) {
  const [addingVariant, setAddingVariant] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/menu" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <ArrowLeft size={14} />
          Back to menu
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{item.name}</h1>
          <Badge tone={item.active ? "success" : "neutral"}>{item.active ? "Active" : "Archived"}</Badge>
        </div>
      </div>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--color-text-primary)]">Details</h2>
        <ItemDetailsForm item={item} categories={categories} canWrite={canWrite} />
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Variants & recipes</h2>
          {canWrite ? (
            <Button size="sm" onClick={() => setAddingVariant(true)}>
              <Plus size={14} />
              Add variant
            </Button>
          ) : null}
        </div>

        {variants.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No variants yet. Add one (e.g. &quot;Regular&quot;) before this item can be sold or have a recipe.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--color-border)]">
            {variants.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--color-text-primary)]">{v.name}</span>
                  <span className="tabular-nums text-sm text-[var(--color-text-secondary)]">{formatIDR(v.price)}</span>
                  <Badge tone={v.active ? "success" : "neutral"}>{v.active ? "Active" : "Archived"}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/menu/${item.id}/recipe?variant=${v.id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-accent-primary)] hover:underline"
                  >
                    <ChefHat size={14} />
                    Recipe
                  </Link>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => setEditingVariant(v)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                  ) : null}
                  {canWrite ? (
                    <ToastForm
                      action={setVariantActiveAction}
                      successMessage={v.active ? "Variant archived." : "Variant restored."}
                    >
                      <input type="hidden" name="menuItemId" value={item.id} />
                      <input type="hidden" name="variantId" value={v.id} />
                      <input type="hidden" name="active" value={(!v.active).toString()} />
                      <button type="submit" className="text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                        {v.active ? "Archive" : "Restore"}
                      </button>
                    </ToastForm>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Modifier groups</h2>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Choose which modifier groups customers can pick from for this item.
        </p>
        <ModifierGroupAssignment
          menuItemId={item.id}
          modifierGroups={modifierGroups}
          assignedIds={assignedModifierGroupIds}
          canWrite={canWrite}
        />
      </section>

      <Modal
        open={addingVariant}
        onClose={() => setAddingVariant(false)}
        title="Add variant"
        maxWidthClassName="max-w-[640px]"
      >
        <VariantForm
          menuItemId={item.id}
          ingredients={ingredients}
          canWriteRecipe={canWriteRecipe}
          onDone={() => setAddingVariant(false)}
        />
      </Modal>

      <Modal open={editingVariant !== null} onClose={() => setEditingVariant(null)} title="Edit variant">
        {editingVariant ? (
          <EditVariantForm
            menuItemId={item.id}
            variant={editingVariant}
            onDone={() => setEditingVariant(null)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function ItemDetailsForm({ item, categories, canWrite }: { item: Item; categories: Category[]; canWrite: boolean }) {
  const [state, formAction, isPending] = useActionState<FormActionState, FormData>(updateMenuItemAction, undefined);
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Item saved.");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={item.id} />
      {/* Price now lives on the variant(s) below, not here — every item
          always has at least one variant (see menu-service.createMenuItem),
          so basePrice only still matters as the value that seeded the first
          one at creation time. Carried through unchanged so the shared
          menuItemInputSchema (creation still needs it) stays satisfied. */}
      <input type="hidden" name="basePrice" value={item.basePrice} />
      <Field label="Name" htmlFor="name" error={errorState?.fieldErrors?.name}>
        <input id="name" name="name" defaultValue={item.name} disabled={!canWrite} required className={inputClassName} />
      </Field>
      <Field label="Category" htmlFor="categoryId">
        <Select id="categoryId" name="categoryId" defaultValue={item.categoryId ?? ""} disabled={!canWrite}>
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Description" htmlFor="description">
        <textarea id="description" name="description" defaultValue={item.description ?? ""} disabled={!canWrite} className={textareaClassName} />
      </Field>
      <ImageField defaultUrl={item.imageUrl} error={errorState?.fieldErrors?.imageUrl} disabled={!canWrite} />
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <Checkbox name="tracksInventory" defaultChecked={item.tracksInventory} disabled={!canWrite} />
          Track ingredient stock
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <Checkbox name="active" defaultChecked={item.active} disabled={!canWrite} />
          Available for sale
        </label>
      </div>

      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState.error}
        </p>
      ) : null}

      {canWrite ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function VariantForm({
  menuItemId,
  ingredients,
  canWriteRecipe,
  onDone,
}: {
  menuItemId: string;
  ingredients: IngredientOption[];
  canWriteRecipe: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [lines, setLines] = useState<RecipeLineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const showToast = useToast();

  function updateLine(key: string, patch: Partial<RecipeLineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }
  function addLine() {
    setLines((prev) => [...prev, { key: newRecipeLineKey(), ingredientId: "", quantityBaseUnits: 0, wastePercentage: 0, notes: "" }]);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createVariantWithRecipeAction(
        menuItemId,
        { name, price, active: true, displayOrder: 0 },
        lines
          .filter((l) => l.ingredientId)
          .map((l) => ({
            ingredientId: l.ingredientId,
            quantityBaseUnits: l.quantityBaseUnits,
            wastePercentage: l.wastePercentage,
            notes: l.notes,
          })),
      );
      if (result.ok) {
        showToast("success", "Variant added.");
        onDone();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        showToast("error", result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="variant-name" error={fieldErrors.name}>
        <input
          id="variant-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="e.g. Regular"
          className={inputClassName}
        />
      </Field>
      <Field label="Price (Rp)" htmlFor="variant-price" error={fieldErrors.price}>
        <input
          id="variant-price"
          type="number"
          min={0}
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={inputClassName}
        />
      </Field>

      {canWriteRecipe ? (
        <div>
          <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">Recipe (optional)</p>
          <p className="mb-2 text-xs text-[var(--color-text-muted)]">
            Waste % inflates how much is actually drawn from stock beyond the stated quantity — for prep loss like
            spillage, trimming, or evaporation. Leave it at 0 if there&apos;s nothing worth accounting for.
          </p>
          <RecipeLinesTable
            lines={lines}
            ingredients={ingredients}
            canWrite
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
            onAddLine={addLine}
          />
          <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
            You can leave this empty and add ingredients later from the variant&apos;s Recipe link.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Add variant"}
        </Button>
      </div>
    </form>
  );
}

function EditVariantForm({
  menuItemId,
  variant,
  onDone,
}: {
  menuItemId: string;
  variant: Variant;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState<FormActionState, FormData>(updateVariantAction, undefined);
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Variant saved.");

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="menuItemId" value={menuItemId} />
      <input type="hidden" name="variantId" value={variant.id} />
      {/* Archiving stays a separate action (the list's Archive/Restore
          button) — this form only ever touches name/price. */}
      {variant.active ? <input type="hidden" name="active" value="on" /> : null}
      <Field label="Name" htmlFor="edit-variant-name" error={errorState?.fieldErrors?.name}>
        <input id="edit-variant-name" name="name" defaultValue={variant.name} required className={inputClassName} />
      </Field>
      <Field label="Price (Rp)" htmlFor="edit-variant-price" error={errorState?.fieldErrors?.price}>
        <input
          id="edit-variant-price"
          name="price"
          type="number"
          min={0}
          defaultValue={variant.price}
          required
          className={inputClassName}
        />
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
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ModifierGroupAssignment({
  menuItemId,
  modifierGroups,
  assignedIds,
  canWrite,
}: {
  menuItemId: string;
  modifierGroups: ModifierGroup[];
  assignedIds: string[];
  canWrite: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedIds));
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  const dirty =
    selected.size !== assignedIds.length || assignedIds.some((id) => !selected.has(id));

  if (modifierGroups.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No modifier groups defined yet — add some from the Modifiers tab.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {modifierGroups.map((group) => {
          const checked = selected.has(group.id);
          return (
            <label
              key={group.id}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                checked
                  ? "border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                  : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
              }`}
            >
              <input
                type="checkbox"
                className="hidden"
                checked={checked}
                disabled={!canWrite}
                onChange={() => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  });
                }}
              />
              {group.name}
              {!group.active ? " (archived)" : ""}
            </label>
          );
        })}
      </div>
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await setItemModifierGroupsAction(menuItemId, Array.from(selected));
                showToast("success", "Modifier groups saved.");
              } catch (error) {
                unstable_rethrow(error);
                showToast("error", error instanceof Error ? error.message : "Couldn't save modifier groups.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save assignment"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
