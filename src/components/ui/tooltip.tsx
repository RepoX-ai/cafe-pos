"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Hover/focus hint anchored to its child. The bubble is portaled to
 * document.body and positioned with `fixed` coordinates taken from the
 * trigger's rect, for the same reason <Select> does it: `overflow-x: auto`
 * on an ancestor forces `overflow-y` to clip too per the CSS spec, which
 * would cut the bubble off inside a horizontally scrollable table.
 */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [position, setPosition] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = position !== null;

  function show() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = rect.top < 56;
    setPosition({ top: below ? rect.bottom + 6 : rect.top - 6, left: rect.left + rect.width / 2, below });
  }

  function hide() {
    setPosition(null);
  }

  // Any scroll or resize moves the trigger out from under a `fixed` bubble,
  // so dismiss rather than chase it.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex cursor-help items-center rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-primary)]"
      >
        {children}
      </span>
      {open
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              style={{ top: position.top, left: position.left }}
              className={`pointer-events-none fixed z-50 max-w-xs -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] px-2.5 py-1.5 text-xs text-[var(--color-surface)] shadow-lg ${
                position.below ? "" : "-translate-y-full"
              }`}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
