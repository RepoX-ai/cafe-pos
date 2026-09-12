"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modal semantics provide focus containment, Escape, and focus restoration. */
export function Dialog({ open, label, onClose, children, className = "" }: {
  open: boolean; label: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previous; };
  }, [open]);
  return <dialog ref={ref} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    } }}
    className={`m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-visible rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-0 text-[var(--color-text-primary)] backdrop:bg-black/30 ${className}`}>
    {open ? children : null}
  </dialog>;
}
