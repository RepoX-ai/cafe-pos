"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";
import { ToastForm } from "./toast-form";

/**
 * The confirm step for a destructive action, with no trigger of its own —
 * row actions live in an `ActionMenu`, whose items are callbacks, so the
 * owning row holds the open/closed state and renders this beside the menu.
 *
 * `description` is where the dialog spells out what the delete takes with
 * it, cascades included, since none of it can be undone.
 */
export function ConfirmDeleteDialog({
  open,
  onClose,
  action,
  fields,
  title,
  description,
  confirmLabel = "Delete permanently",
  successMessage,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  action: (formData: FormData) => Promise<void>;
  /** Hidden inputs the action reads off the submitted FormData. */
  fields: Record<string, string>;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  successMessage: string;
  onDeleted?: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-5">
        <div className="text-sm text-[var(--color-text-secondary)]">{description}</div>
        <ToastForm
          action={action}
          successMessage={successMessage}
          onSettled={(ok) => {
            onClose();
            if (ok) onDeleted?.();
          }}
        >
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="danger">
              {confirmLabel}
            </Button>
          </div>
        </ToastForm>
      </div>
    </Modal>
  );
}
