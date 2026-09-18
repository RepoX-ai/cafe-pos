"use client";

import { useState } from "react";
import { Check, Plus, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { createBusinessAction } from "./actions";

export interface OwnedBusiness {
  businessId: string;
  name: string;
  orderNumberPrefix: string;
  isCurrent: boolean;
}

/**
 * The owner's own list of businesses, and the form that creates another.
 *
 * Rendered only when the viewer holds `business:create` — the server
 * action checks the same permission, so hiding this is a convenience, not
 * the boundary.
 */
export function BusinessesSection({ businesses }: { businesses: OwnedBusiness[] }) {
  const [creating, setCreating] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const showToast = useToast();

  function open() {
    setError(null);
    setFieldErrors({});
    setCreating(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsPending(true);
    setError(null);
    setFieldErrors({});
    const result = await createBusinessAction({
      name: form.get("name"),
      orderNumberPrefix: form.get("orderNumberPrefix"),
    });
    setIsPending(false);
    if (!result.ok) {
      setError(result.fieldErrors ? null : result.error);
      setFieldErrors(result.fieldErrors ?? {});
      showToast("error", result.error);
      return;
    }
    showToast("success", `"${result.businessName}" created. Switch to it from the menu at the top right.`);
    setCreating(false);
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Your businesses</h2>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
        Each business is completely separate — its own menu, ingredients, stock, staff and books. Nothing is shared
        between them, and a new one starts empty.
      </p>

      <ul className="mb-4 flex flex-col gap-2">
        {businesses.map((business) => (
          <li
            key={business.businessId}
            className="flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2.5"
          >
            <Store size={16} className="shrink-0 text-[var(--color-text-muted)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                {business.name}
              </span>
              <span className="block text-xs text-[var(--color-text-muted)]">
                Order prefix {business.orderNumberPrefix}
              </span>
            </span>
            {business.isCurrent ? (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-accent-primary)]">
                <Check size={14} />
                Current
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <Button variant="secondary" size="sm" onClick={open}>
        <Plus size={14} />
        Add a business
      </Button>

      <Modal open={creating} onClose={() => setCreating(false)} title="Add a business">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="new-business-name" className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">
              Business name
            </label>
            <input
              id="new-business-name"
              name="name"
              required
              maxLength={200}
              autoComplete="off"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            />
            {fieldErrors.name ? <p className="mt-1 text-xs text-[var(--color-danger)]">{fieldErrors.name}</p> : null}
          </div>

          <div>
            <label
              htmlFor="new-business-prefix"
              className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]"
            >
              Order number prefix
            </label>
            <input
              id="new-business-prefix"
              name="orderNumberPrefix"
              required
              defaultValue="ORD"
              maxLength={8}
              autoComplete="off"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm uppercase"
            />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Starts every order number at this business, e.g. <code className="text-xs">ORD-00001</code>. Use something
              different from your other businesses so receipts are easy to tell apart.
            </p>
            {fieldErrors.orderNumberPrefix ? (
              <p className="mt-1 text-xs text-[var(--color-danger)]">{fieldErrors.orderNumberPrefix}</p>
            ) : null}
          </div>

          <p className="text-sm text-[var(--color-text-secondary)]">
            You&apos;ll be its Owner. It starts with no menu, no ingredients and no other staff — set those up after
            switching to it.
          </p>

          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create business"}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
