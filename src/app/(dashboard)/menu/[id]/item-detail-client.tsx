"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, ChefHat, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { Field, inputClassName, textareaClassName } from "@/components/ui/form-field";
import {
  createVariantAction,
  setItemModifierGroupsAction,
  setVariantActiveAction,
  updateMenuItemAction,
  type FormActionState,
} from "../actions";

interface Item {
  id: string;
  name: string;
  description: string | null;
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

function formatIDR(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

export function ItemDetailClient({
  item,
  variants,
  assignedModifierGroupIds,
  categories,
  modifierGroups,
  canWrite,
}: {
  item: Item;
  variants: Variant[];
  assignedModifierGroupIds: string[];
  categories: Category[];
  modifierGroups: ModifierGroup[];
  canWrite: boolean;
}) {
  const [addingVariant, setAddingVariant] = useState(false);

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
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-primary)] hover:underline"
                  >
                    <ChefHat size={14} />
                    Recipe
                  </Link>
                  {canWrite ? (
                    <form action={setVariantActiveAction}>
                      <input type="hidden" name="menuItemId" value={item.id} />
                      <input type="hidden" name="variantId" value={v.id} />
                      <input type="hidden" name="active" value={(!v.active).toString()} />
                      <button type="submit" className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                        {v.active ? "Archive" : "Restore"}
                      </button>
                    </form>
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

      <Drawer open={addingVariant} onClose={() => setAddingVariant(false)} title="Add variant">
        <VariantForm menuItemId={item.id} onDone={() => setAddingVariant(false)} />
      </Drawer>
    </div>
  );
}

function ItemDetailsForm({ item, categories, canWrite }: { item: Item; categories: Category[]; canWrite: boolean }) {
  const [state, formAction, isPending] = useActionState<FormActionState, FormData>(updateMenuItemAction, undefined);
  const errorState = state && !state.ok ? state : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={item.id} />
      <Field label="Name" htmlFor="name" error={errorState?.fieldErrors?.name}>
        <input id="name" name="name" defaultValue={item.name} disabled={!canWrite} required className={inputClassName} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Category" htmlFor="categoryId">
          <select id="categoryId" name="categoryId" defaultValue={item.categoryId ?? ""} disabled={!canWrite} className={inputClassName}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base price (Rp)" htmlFor="basePrice" error={errorState?.fieldErrors?.basePrice}>
          <input
            id="basePrice"
            name="basePrice"
            type="number"
            min={0}
            defaultValue={item.basePrice}
            disabled={!canWrite}
            required
            className={inputClassName}
          />
        </Field>
      </div>
      <Field label="Description" htmlFor="description">
        <textarea id="description" name="description" defaultValue={item.description ?? ""} disabled={!canWrite} className={textareaClassName} />
      </Field>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <input type="checkbox" name="tracksInventory" defaultChecked={item.tracksInventory} disabled={!canWrite} />
          Track ingredient stock
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <input type="checkbox" name="active" defaultChecked={item.active} disabled={!canWrite} />
          Available for sale
        </label>
      </div>

      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
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

function VariantForm({ menuItemId, onDone }: { menuItemId: string; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<FormActionState, FormData>(createVariantAction, undefined);
  const errorState = state && !state.ok ? state : undefined;

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="menuItemId" value={menuItemId} />
      <Field label="Name" htmlFor="name" error={errorState?.fieldErrors?.name}>
        <input id="name" name="name" required placeholder="e.g. Regular" className={inputClassName} />
      </Field>
      <Field label="Price (Rp)" htmlFor="price" error={errorState?.fieldErrors?.price}>
        <input id="price" name="price" type="number" min={0} required className={inputClassName} />
      </Field>
      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState.error}
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
              await setItemModifierGroupsAction(menuItemId, Array.from(selected));
              setSaving(false);
            }}
          >
            {saving ? "Saving…" : "Save assignment"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
