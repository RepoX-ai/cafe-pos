"use client";

import { formatIDR } from "@/lib/money/money";
import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImageOff, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { Pagination } from "@/components/ui/pagination";
import { usePagination } from "@/components/ui/use-pagination";
import {
  createCategoryAction,
  createModifierGroupAction,
  createModifierOptionAction,
  deleteCategoryAction,
  deleteMenuItemAction,
  deleteModifierGroupAction,
  deleteModifierOptionAction,
  setCategoryActiveAction,
  setMenuItemActiveAction,
  setModifierGroupActiveAction,
  setModifierOptionActiveAction,
  type FormActionState,
} from "./actions";
import { createMenuItemAction } from "./actions";
import { ImageField } from "./image-field";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { formDataOf, useToastAction } from "@/components/ui/use-toast-action";
import { useActionResultToast } from "@/components/ui/use-action-toast";

export interface CategoryRow {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
}

export interface VariantRow {
  id: string;
  name: string;
  price: number;
  active: boolean;
  displayOrder: number;
}

export interface MenuItemRow {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  basePrice: number;
  active: boolean;
  tracksInventory: boolean;
  displayOrder: number;
  variants: VariantRow[];
}

export interface ModifierOptionRow {
  id: string;
  name: string;
  priceAdjustment: number;
  active: boolean;
  displayOrder: number;
}

export interface ModifierGroupRow {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  active: boolean;
  options: ModifierOptionRow[];
}

type Tab = "items" | "categories" | "modifiers";

export function MenuClient({
  categories,
  items,
  modifierGroups,
  canWrite,
}: {
  categories: CategoryRow[];
  items: MenuItemRow[];
  modifierGroups: ModifierGroupRow[];
  canWrite: boolean;
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
      {tab === "modifiers" ? <ModifiersTab groups={modifierGroups} canWrite={canWrite} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function ItemsTab({
  items,
  categories,
  canWrite,
}: {
  items: MenuItemRow[];
  categories: CategoryRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all");

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (categoryFilter !== "all") {
        if (categoryFilter === "none") {
          if (item.categoryId) return false;
        } else if (item.categoryId !== categoryFilter) {
          return false;
        }
      }
      if (statusFilter === "active" && !item.active) return false;
      if (statusFilter === "archived" && item.active) return false;
      return true;
    });
  }, [items, query, categoryFilter, statusFilter]);

  const { page, setPage, totalPages, pageItems, pageSize, totalItems } = usePagination(filteredItems, 20);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, categoryFilter, statusFilter]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items…"
            className={`${inputClassName} w-full pl-9`}
          />
        </div>
        <div className="w-44">
          <label htmlFor="item-category-filter" className="sr-only">
            Filter by category
          </label>
          <Select id="item-category-filter" value={categoryFilter} onChange={setCategoryFilter}>
            <option value="all">All categories</option>
            <option value="none">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <label htmlFor="item-status-filter" className="sr-only">
            Filter by status
          </label>
          <Select
            id="item-status-filter"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as "all" | "active" | "archived")}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </Select>
        </div>
        {canWrite ? (
          <Button onClick={() => setCreating(true)} className="ml-auto">
            <Plus size={16} />
            New item
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3" />
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Variants</th>
              <th className="px-4 py-3 text-right">Base price</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                  {items.length === 0 ? "No menu items yet." : "No items match your search or filters."}
                </td>
              </tr>
            ) : (
              pageItems.map((item) => {
                // Price now lives on the variant(s), not basePrice (which only
                // ever seeded the first one at creation) — same range display
                // the POS grid uses, so this list doesn't go stale the moment
                // someone edits a variant's price.
                const prices = item.variants.length > 0 ? item.variants.map((v) => v.price) : [item.basePrice];
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                return (
                  <tr
                    key={item.id}
                    onClick={() => router.push(`/menu/${item.id}`)}
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-page-bg)]"
                  >
                    <td className="px-4 py-3">
                      <ItemThumbnail imageUrl={item.imageUrl} name={item.name} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/menu/${item.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent-primary)]"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">{item.categoryName ?? "—"}</td>
                    <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                      {item.variants.length === 0 ? (
                        <Badge tone="warning">No variants</Badge>
                      ) : (
                        item.variants.map((v) => v.name).join(", ")
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {minPrice === maxPrice ? formatIDR(minPrice) : `${formatIDR(minPrice)}–${formatIDR(maxPrice)}`}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={item.active ? "success" : "neutral"}>{item.active ? "Active" : "Archived"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                        <MenuItemRowActions item={item} canWrite={canWrite} />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
        <Pagination page={page} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New menu item">
        <NewItemForm categories={categories} onDone={() => setCreating(false)} />
      </Modal>
    </div>
  );
}

function ItemThumbnail({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-page-bg)]">
        <ImageOff size={14} className="text-[var(--color-text-muted)]" />
      </div>
    );
  }

  return (
    // Same reasoning as the POS thumbnail: product photos are cashier-pasted
    // external URLs, not a fixed set of remote hosts next/image can allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={name}
      className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function NewItemForm({ categories, onDone }: { categories: CategoryRow[]; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<FormActionState, FormData>(createMenuItemAction, undefined);
  const errorState = state && !state.ok ? state : undefined;
  // Success isn't observed here — createMenuItemAction redirects to the new
  // item's page, which is itself the success signal. Failures still toast.
  useActionResultToast(state, "Item created.");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="name" error={errorState?.fieldErrors?.name}>
        <input id="name" name="name" required className={inputClassName} />
      </Field>
      <Field label="Category" htmlFor="categoryId">
        <Select id="categoryId" name="categoryId">
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Base price (Rp)" htmlFor="basePrice" error={errorState?.fieldErrors?.basePrice}>
        <input id="basePrice" name="basePrice" type="number" min={0} step={1} required className={inputClassName} />
      </Field>
      <ImageField error={errorState?.fieldErrors?.imageUrl} />
      <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
        <Checkbox name="tracksInventory" defaultChecked />
        Track ingredient stock for this item
      </label>
      <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
        <Checkbox name="active" defaultChecked />
        Available for sale
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
          {isPending ? "Creating…" : "Create item"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesTab({
  categories,
  itemsPerCategory,
  canWrite,
}: {
  categories: CategoryRow[];
  itemsPerCategory: Map<string, number>;
  canWrite: boolean;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div>
      {canWrite ? (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            New category
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Display order</th>
              <th className="px-4 py-3">Status</th>
              {canWrite ? <th className="px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                  No categories yet.
                </td>
              </tr>
            ) : (
              categories.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{c.name}</td>
                  <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">{c.displayOrder}</td>
                  <td className="px-4 py-3">
                    <Badge tone={c.active ? "success" : "neutral"}>{c.active ? "Active" : "Archived"}</Badge>
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <CategoryRowActions category={c} itemCount={itemsPerCategory.get(c.id) ?? 0} />
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New category">
        <CategoryForm onDone={() => setCreating(false)} />
      </Modal>
    </div>
  );
}

function CategoryForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<FormActionState, FormData>(createCategoryAction, undefined);
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Category created.");

  useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Name" htmlFor="name" error={errorState?.fieldErrors?.name}>
        <input id="name" name="name" required className={inputClassName} />
      </Field>
      <Field label="Display order" htmlFor="displayOrder">
        <input id="displayOrder" name="displayOrder" type="number" defaultValue={0} className={inputClassName} />
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
          {isPending ? "Saving…" : "Create category"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

function ModifiersTab({ groups, canWrite }: { groups: ModifierGroupRow[]; canWrite: boolean }) {
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [addingOptionTo, setAddingOptionTo] = useState<string | null>(null);

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
                    {canWrite ? (
                      <ModifierOptionActions groupId={group.id} option={opt} />
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

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------
//
// Every per-row action across the dashboard goes behind the same "…" menu
// (`ActionMenu`), so a row's affordance never depends on which table it is
// in. Each of these owns its own confirm-dialog state, because a menu item
// is a callback and the menu closes as soon as one fires.

function MenuItemRowActions({ item, canWrite }: { item: MenuItemRow; canWrite: boolean }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const { run, isPending } = useToastAction();

  const items: ActionMenuItem[] = [
    { label: canWrite ? "Edit item" : "View item", onSelect: () => router.push(`/menu/${item.id}`) },
  ];
  if (canWrite) {
    items.push(
      {
        label: item.active ? "Archive" : "Restore",
        onSelect: () =>
          run(
            () => setMenuItemActiveAction(formDataOf({ id: item.id, active: (!item.active).toString() })),
            { success: item.active ? "Item archived." : "Item restored." },
          ),
        disabled: isPending,
      },
      { label: "Delete permanently", onSelect: () => setDeleting(true), tone: "danger", disabled: isPending },
    );
  }

  return (
    <>
      <ActionMenu label={`Actions for ${item.name}`} items={items} />
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        action={deleteMenuItemAction}
        fields={{ id: item.id }}
        title={`Delete "${item.name}"?`}
        successMessage={`"${item.name}" deleted.`}
        description={
          <>
            This removes the item, its variants, and their recipes for good. It can&rsquo;t be
            undone.
            <br />
            <br />
            Past orders are unaffected — they keep their own record of what was sold, so receipts
            and every sales report stay exactly as they are.
          </>
        }
      />
    </>
  );
}

function CategoryRowActions({ category, itemCount }: { category: CategoryRow; itemCount: number }) {
  const [deleting, setDeleting] = useState(false);
  const { run, isPending } = useToastAction();

  return (
    <>
      <ActionMenu
        label={`Actions for ${category.name}`}
        items={[
          {
            label: category.active ? "Archive" : "Restore",
            onSelect: () =>
              run(
                () =>
                  setCategoryActiveAction(
                    formDataOf({ id: category.id, active: (!category.active).toString() }),
                  ),
                { success: category.active ? "Category archived." : "Category restored." },
              ),
            disabled: isPending,
          },
          { label: "Delete permanently", onSelect: () => setDeleting(true), tone: "danger", disabled: isPending },
        ]}
      />
      <ConfirmDeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        action={deleteCategoryAction}
        fields={{ id: category.id }}
        title={`Delete "${category.name}"?`}
        successMessage={`"${category.name}" deleted.`}
        description={
          <>
            This removes the category for good. It can&rsquo;t be undone.
            {itemCount > 0 ? (
              <>
                {" "}
                Its {itemCount} menu item{itemCount === 1 ? "" : "s"} stay on the menu and become
                uncategorized.
              </>
            ) : null}
            <br />
            <br />
            Past orders are unaffected — they keep the category they were sold under, so sales
            reports stay exactly as they are.
          </>
        }
      />
    </>
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

function ModifierOptionActions({ groupId, option }: { groupId: string; option: ModifierOptionRow }) {
  const [deleting, setDeleting] = useState(false);
  const { run, isPending } = useToastAction();

  return (
    <>
      <ActionMenu
        size="sm"
        label={`Actions for ${option.name}`}
        items={[
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
          { label: "Delete permanently", onSelect: () => setDeleting(true), tone: "danger", disabled: isPending },
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
