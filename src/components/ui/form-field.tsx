"use client";

import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--color-text-primary)]">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-[var(--color-text-muted)]">{hint}</p> : null}
      {error ? <p className="text-xs text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

const triggerClassName =
  "flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-3 pr-2.5 text-sm text-[var(--color-text-primary)] outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50";

interface OptionData {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

// Callers pass plain <option> children (often via .map()), exactly like a
// native <select> — parsed here instead of asking every call site to adopt
// a different data shape, so this stayed a drop-in replacement for the
// native element everywhere it was already used.
function parseOptions(children: ReactNode): OptionData[] {
  const options: OptionData[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return;
    if (child.type !== "option") return;
    options.push({
      value: child.props.value ?? "",
      label: child.props.children,
      disabled: !!child.props.disabled,
    });
  });
  return options;
}

interface SelectProps {
  id?: string;
  /** Renders a hidden input with this name, for plain <form> submission. */
  name?: string;
  /** Controlled value. Omit and use `defaultValue` for uncontrolled. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** Accepted for parity with existing call sites; see the note below on why it's a no-op. */
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Styled replacement for a native <select>. The native popup is OS-drawn
 * chrome that CSS essentially cannot touch in any browser, so getting a
 * designed open state means owning the listbox ourselves — this renders a
 * real button + a keyboard-navigable option list instead of a real
 * <select>. The list is portaled to document.body and positioned with
 * `fixed` coordinates from the trigger's rect (rather than `absolute`
 * inside the trigger's own wrapper) so it isn't clipped when the trigger
 * sits inside a horizontally-scrolling container — `overflow-x: auto`
 * forces `overflow-y` to clip too per the CSS spec, which silently cut off
 * this dropdown when it lived inside a scrollable table. Form submission
 * still works via a hidden input (see DatePicker for the same pattern);
 * native `required` / constraint-validation bubbles don't apply to a
 * hidden input, so that's not enforced here — callers already show
 * server-validated field errors via <Field error=.../> as the fallback.
 */
export function Select({ id, name, value, defaultValue, onChange, disabled, className, children }: SelectProps) {
  const options = useMemo(() => parseOptions(children), [children]);
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? "");
  const selected = isControlled ? value : internalValue;
  const selectedIndex = options.findIndex((o) => o.value === selected);

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (listboxRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Scroll events don't bubble, so this only catches them via the
    // capture phase — closing on any ancestor scroll avoids the listbox
    // drifting away from its (now `fixed`, not scroll-following) trigger.
    function handleScroll(e: Event) {
      if (e.target instanceof Node && listboxRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", closeOnResize);
    function closeOnResize() { setOpen(false); }
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  function openList() {
    if (disabled) return;
    setPortalRoot(triggerRef.current?.closest("dialog, .force-light-theme") ?? document.body);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const upward = below < Math.min(256, options.length * 32 + 8) && above > below;
      const maxHeight = Math.max(32, Math.min(256, upward ? above : below));
      const height = Math.min(maxHeight, options.length * 32 + 8);
      const width = Math.min(rect.width, window.innerWidth - 16);
      setPosition({ top: upward ? rect.top - height - 6 : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width, maxHeight });
    }
    setHighlighted(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function closeList() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function commit(index: number) {
    const option = options[index];
    if (disabled || !option || option.disabled) return;
    if (!isControlled) setInternalValue(option.value);
    onChange?.(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveHighlight(delta: number) {
    setHighlighted((prev) => {
      let next = prev;
      for (let step = 0; step < options.length; step++) {
        next = (next + delta + options.length) % options.length;
        if (!options[next]?.disabled) break;
      }
      optionRefs.current[next]?.scrollIntoView({ block: "nearest" });
      return next;
    });
  }

  // Focus stays on the trigger button the whole time (the "select-only
  // combobox" ARIA pattern) — the listbox itself is never focused, so all
  // keyboard handling lives here, with `aria-activedescendant` telling
  // assistive tech which option is highlighted.
  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(highlighted);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeList();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const selectedOption = options[selectedIndex];

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      {name ? <input type="hidden" name={name} value={selected} disabled={disabled} /> : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleTriggerKeyDown}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? optionId(highlighted) : undefined}
        className={`${triggerClassName} ${open ? "border-[var(--color-accent-primary)]" : ""}`}
      >
        <span className="truncate">{selectedOption?.label ?? ""}</span>
        <ChevronDown
          size={15}
          aria-hidden
          className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && !disabled && portalRoot && position
        ? createPortal(
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-hidden={!open}
              style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
              className={`fixed z-50  origin-top overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg transition-[opacity,transform] duration-150 ${
                open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
              }`}
            >
              {options.map((option, index) => (
                <button
                  key={`${option.value}-${index}`}
                  id={optionId(index)}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  tabIndex={-1}
                  disabled={option.disabled}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => commit(index)}
                  className={`flex w-full items-center justify-between gap-2 rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    index === highlighted && !option.disabled ? "bg-[var(--color-page-bg)]" : ""
                  } ${index === selectedIndex ? "font-medium text-[var(--color-accent-primary)]" : "text-[var(--color-text-primary)]"}`}
                >
                  <span className="truncate">{option.label}</span>
                  {index === selectedIndex ? <Check size={14} className="shrink-0" /> : null}
                </button>
              ))}
            </div>,
            portalRoot,
          )
        : null}
    </div>
  );
}
