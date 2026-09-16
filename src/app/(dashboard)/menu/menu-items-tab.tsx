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
import { createMenuItemAction, deleteMenuItemAction, setMenuItemActiveAction, type FormActionState } from "./actions";
import { ImageField } from "./image-field";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/action-menu";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { formDataOf, useToastAction } from "@/components/ui/use-toast-action";
import { useActionResultToast } from "@/components/ui/use-action-toast";
import type { CategoryRow, MenuItemRow } from "./menu-types";

export function ItemsTab({
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
              <th className="px-4 py-3">Base price</th>
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
                    <td className="px-4 py-3 tabular-nums">
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
