"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";
import { ToastForm } from "./toast-form";

/**
 * "Delete permanently" affordance, as the counterpart to the archive
 * toggles across the dashboard: a quiet trigger that opens a confirm
 * dialog before submitting `fields` to a void server action.
 *
 * Whether a given row may actually be deleted is the server's call, not
 * this component's — the menu services refuse anything that already
 * appears on an order and throw a message written for the person who
 * clicked, which `ToastForm` surfaces as the failure toast. `disabled`
 * exists only to say so up front where the page already knows.
 */
export function DeleteButton({
  action,
  fields,
  title,
  description,
  confirmLabel = "Delete permanently",
  successMessage,
  onDeleted,
  disabled = false,
  disabledReason,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Hidden inputs the action reads off the submitted FormData. */
  fields: Record<string, string>;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  successMessage: string;
  onDeleted?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Names the trigger for screen readers and as a tooltip — several call
  // sites render it icon-only, where "Delete" alone says nothing about
  // which row is about to go.
  const label = title.replace(/\?$/, "");

  return (
    // `display: contents` keeps the trigger in its parent's flex row while
    // still giving both it and the dialog a common ancestor to stop click
    // propagation at — menu rows navigate on click, and a native <dialog>
    // still bubbles its events up the React tree.
    <div className="contents" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        title={disabled ? disabledReason : label}
        onClick={() => setOpen(true)}
        className={
          className ??
          "text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)] disabled:hover:text-[var(--color-text-muted)]"
        }
      >
        {children ?? "Delete"}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="flex flex-col gap-5">
          <div className="text-sm text-[var(--color-text-secondary)]">{description}</div>
          <ToastForm
            action={action}
            successMessage={successMessage}
            onSettled={(ok) => {
              setOpen(false);
              if (ok) onDeleted?.();
            }}
          >
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger">
                {confirmLabel}
              </Button>
            </div>
          </ToastForm>
        </div>
      </Modal>
    </div>
  );
}
