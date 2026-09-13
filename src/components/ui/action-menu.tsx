"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  /** Renders the item in the danger colour — destructive actions. */
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Tooltip explaining why, shown when `disabled`. */
  disabledReason?: string;
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 34;

/**
 * Row-level "…" menu, for tables whose per-row actions outgrew a single
 * line of inline buttons.
 *
 * Positioning follows the same approach as `Select`: the menu is portaled
 * out and placed with `fixed` coordinates from the trigger's rect, rather
 * than absolutely inside the trigger's wrapper. Table rows usually live in
 * an `overflow-x: auto` container, and per the CSS spec that forces
 * `overflow-y` to clip too — an absolutely-positioned menu gets silently
 * cut off at the row's edge.
 *
 * Keyboard handling differs from `Select` on purpose. A select-only
 * combobox keeps focus on its trigger and points at the active option with
 * `aria-activedescendant`; a menu button moves real focus into the menu,
 * so the items are the focusable things here and the highlight is just
 * `:focus`.
 */
export function ActionMenu({ items, label = "Actions" }: { items: ActionMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /**
   * The focusable items, read from the DOM rather than tracked in state.
   * `items` is rebuilt by the parent on every render, so it can't go in a
   * dependency array without the open-menu effect re-running and stealing
   * focus back; querying also drops disabled entries for free, since a
   * disabled <button> isn't focusable anyway.
   */
  function focusableItems() {
    return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Scroll doesn't bubble, so this only fires via the capture phase.
    // Closing on any ancestor scroll stops the menu drifting away from its
    // (now `fixed`, no longer scroll-following) trigger.
    function handleScroll(e: Event) {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function handleResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  // Moving focus into the menu is what makes this a menu button rather
  // than a popup of unrelated buttons — Escape and the arrow keys then
  // have somewhere to act from.
  useEffect(() => {
    if (!open) return;
    focusableItems()[0]?.focus();
  }, [open]);

  function openMenu() {
    setPortalRoot(triggerRef.current?.closest("dialog, .force-light-theme") ?? document.body);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const height = items.length * ITEM_HEIGHT + 8;
      const below = window.innerHeight - rect.bottom - 14;
      const upward = below < height && rect.top - 14 > below;
      setPosition({
        top: upward ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
        // Right edge of the menu lines up with the right edge of the
        // trigger, then clamped into the viewport.
        left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
      });
    }
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function commit(index: number) {
    const item = items[index];
    if (!item || item.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    item.onSelect();
  }

  function moveFocus(delta: number) {
    const nodes = focusableItems();
    if (nodes.length === 0) return;
    const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
    nodes[(current + delta + nodes.length) % nodes.length]?.focus();
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      // Also stops Enter/Space firing the button's native click, which
      // would immediately toggle the menu back shut.
      e.preventDefault();
      openMenu();
    }
  }

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)] ${
          open ? "bg-[var(--color-page-bg)] text-[var(--color-text-primary)]" : ""
        }`}
      >
        <MoreVertical size={16} aria-hidden />
      </button>

      {open && portalRoot && position
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              onKeyDown={handleMenuKeyDown}
              style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
              className="fixed z-50 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-left shadow-lg"
            >
              {items.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={item.disabled}
                  title={item.disabled ? item.disabledReason : undefined}
                  onClick={() => commit(index)}
                  className={`flex w-full items-center rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-page-bg)] focus:bg-[var(--color-page-bg)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                    item.tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
}
