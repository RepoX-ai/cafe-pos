"use client";

import { useEffect, useRef, useState } from "react";
import { todayInBusinessTimezone } from "@/lib/dates/dates";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { inputClassName } from "@/components/ui/form-styles";
import {
  WEEKDAY_LABELS,
  buildMonthCells,
  formatDisplay,
  formatMonthYear,
  toDateOnly,
  toValue,
} from "@/components/ui/calendar-utils";

interface DatePickerProps {
  id?: string;
  /** Renders a hidden input with this name, for plain <form> submission. */
  name?: string;
  /** Controlled value (Y-M-D). Omit and use `defaultValue` for uncontrolled. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function DatePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  placeholder = "Select date",
  className,
}: DatePickerProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const selected = isControlled ? value : internalValue;

  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => toDateOnly(selected || todayInBusinessTimezone()));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function openPicker() {
    setViewDate(toDateOnly(selected || todayInBusinessTimezone()));
    setOpen(true);
  }

  function selectDate(date: Date) {
    const next = toValue(date);
    if (!isControlled) setInternalValue(next);
    onChange?.(next);
    setOpen(false);
  }

  const year = viewDate.getUTCFullYear();
  const month = viewDate.getUTCMonth();
  const todayValue = todayInBusinessTimezone();
  const cells = buildMonthCells(viewDate);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      {name ? <input type="hidden" name={name} value={selected} /> : null}
      <button
        type="button"
        id={id}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${inputClassName} flex w-full items-center justify-between gap-2 text-left`}
      >
        <span className={selected ? "" : "text-[var(--color-text-muted)]"}>
          {selected ? formatDisplay(selected) : placeholder}
        </span>
        <Calendar size={15} className="shrink-0 text-[var(--color-text-muted)]" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute z-20 mt-1.5 w-[280px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewDate(new Date(Date.UTC(year, month - 1, 1)))}
              aria-label="Previous month"
              className="rounded-[var(--radius-sm)] p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {formatMonthYear(viewDate)}
            </span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(Date.UTC(year, month + 1, 1)))}
              aria-label="Next month"
              className="rounded-[var(--radius-sm)] p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAY_LABELS.map((d) => (
              <span
                key={d}
                className="flex h-7 items-center justify-center text-[11px] font-medium text-[var(--color-text-muted)]"
              >
                {d}
              </span>
            ))}
            {cells.map(({ date, value: cellValue, inMonth }) => {
              const isSelected = cellValue === selected;
              const isToday = cellValue === todayValue;
              return (
                <button
                  key={cellValue}
                  type="button"
                  onClick={() => selectDate(date)}
                  className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-sm tabular-nums transition-colors ${
                    isSelected
                      ? "bg-[var(--color-accent-primary)] font-semibold text-[var(--color-accent-contrast)]"
                      : inMonth
                        ? "text-[var(--color-text-primary)] hover:bg-[var(--color-page-bg)]"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)]"
                  } ${isToday && !isSelected ? "ring-1 ring-inset ring-[var(--color-accent-primary)]" : ""}`}
                >
                  {date.getUTCDate()}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => selectDate(toDateOnly(todayValue))}
            className="mt-2 w-full rounded-[var(--radius-sm)] py-1.5 text-center text-xs font-medium text-[var(--color-accent-primary)] hover:bg-[var(--color-page-bg)]"
          >
            Today
          </button>
        </div>
      ) : null}
    </div>
  );
}
