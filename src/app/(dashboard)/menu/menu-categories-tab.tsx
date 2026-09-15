"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { createCategoryAction, deleteCategoryAction, setCategoryActiveAction, type FormActionState } from "./actions";
import { ActionMenu } from "@/components/ui/action-menu";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { formDataOf, useToastAction } from "@/components/ui/use-toast-action";
import { useActionResultToast } from "@/components/ui/use-action-toast";
import type { CategoryRow } from "./menu-types";

export function CategoriesTab({
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
