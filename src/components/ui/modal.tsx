"use client";

import { Dialog } from "./dialog";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Tailwind max-width class, e.g. "max-w-[480px]" (default) or
   * "max-w-[640px]" for content that needs more room (a table with several
   * columns). Must be a literal string at the call site — Tailwind only
   * generates arbitrary-value classes it can see verbatim in source, so
   * this can't be built from an interpolated variable.
   */
  maxWidthClassName?: string;
}

/** Centered dialog used for create/edit forms across the admin dashboard. */
export function Modal({ open, title, description, onClose, children, maxWidthClassName = "max-w-[480px]" }: ModalProps) {
  return (
    <Dialog open={open} label={title} onClose={onClose} className={maxWidthClassName}>
      <div
        // `text-left` is deliberate: a <dialog> still inherits CSS from
        // wherever it was declared in the DOM, so a modal opened from a
        // right-aligned table cell rendered its whole form right-aligned.
        // Content alignment shouldn't depend on the call site.
        className={`relative flex max-h-[85vh] w-full ${maxWidthClassName} flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] text-left shadow-lg`}
      >
        <div className="flex items-start justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{description}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </Dialog>
  );
}
