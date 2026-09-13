"use client";

import { useEffect, useRef, useState } from "react";
import { todayInBusinessTimezone } from "@/lib/dates/dates";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  WEEKDAY_LABELS,
  buildMonthCells,
  formatDisplay,
  formatMonthYear,
  toDateOnly,
} from "@/components/ui/calendar-utils";

interface DateRangePickerProps {
  /** Committed range (Y-M-D), shown on the trigger. */
  from: string;
  to: string;
  /** Fires once both ends of a new range are picked. */
  onApply: (range: { from: string; to: string }) => void;
  className?: string;
}

/**
 * One control for a whole date range: a single trigger showing "from → to",
 * opening a single calendar. First click sets the start, second the end
 * (clicking an earlier day than the start just swaps them), and completing the
 * range applies it and closes — so there's no separate From/To field pair and
 * no Apply button competing for header space.
 */
export function DateRangePicker({ from, to, onApply, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  /** Set once the user picks a start but hasn't yet picked an end. Null means
   *  the next click begins a fresh range rather than completing one. */
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState(() => toDateOnly(from || todayInBusinessTimezone()));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Discards a half-picked range so reopening never resumes mid-selection.
    function close() {
      setOpen(false);
      setDraftStart(null);
      setHovered(null);
    }
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      setDraftStart(null);
      setHovered(null);
      return;
    }
    setViewDate(toDateOnly(from || todayInBusinessTimezone()));
    setOpen(true);
  }

  function selectDate(value: string) {
    if (draftStart === null) {
      setDraftStart(value);
      setHovered(null);
      return;
    }
    // Picking backwards is a normal way to express a range — swap, don't reject.
    const [nextFrom, nextTo] = value < draftStart ? [value, draftStart] : [draftStart, value];
    setOpen(false);
    setDraftStart(null);
    setHovered(null);
    onApply({ from: nextFrom, to: nextTo });
  }

  const year = viewDate.getUTCFullYear();
  const month = viewDate.getUTCMonth();
  const todayValue = todayInBusinessTimezone();
  const cells = buildMonthCells(viewDate);

  // Mid-selection the hovered day previews the other end, so the shaded span
  // tracks the cursor instead of only appearing after the second click.
  const previewEnd = draftStart !== null ? hovered : null;
  const [rangeStart, rangeEnd] =
    draftStart === null
      ? [from, to]
      : previewEnd === null
        ? [draftStart, draftStart]
        : previewEnd < draftStart
          ? [previewEnd, draftStart]
          : [draftStart, previewEnd];
  const isSpan = rangeStart !== rangeEnd;

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Date range: ${formatDisplay(from)} to ${formatDisplay(to)}. Choose a different range.`}
        className="flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm text-[var(--color-text-primary)] outline-none transition-colors hover:border-[var(--color-accent-primary)] focus-visible:border-[var(--color-accent-primary)]"
      >
        <Calendar size={15} className="shrink-0 text-[var(--color-text-muted)]" />
        <span className="tabular-nums">
          {formatDisplay(from)} <span className="text-[var(--color-text-muted)]">→</span> {formatDisplay(to)}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a date range"
          // Right-aligned: this sits at the right edge of a page header, where a
          // left-aligned popover would overflow the viewport.
          className="absolute right-0 z-20 mt-1.5 w-[296px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg"
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
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{formatMonthYear(viewDate)}</span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(Date.UTC(year, month + 1, 1)))}
              aria-label="Next month"
              className="rounded-[var(--radius-sm)] p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHovered(null)}>
            {WEEKDAY_LABELS.map((d) => (
              <span
                key={d}
                className="flex h-7 items-center justify-center text-[11px] font-medium text-[var(--color-text-muted)]"
              >
                {d}
              </span>
            ))}
            {cells.map(({ date, value: cellValue, inMonth }) => {
              const isStart = cellValue === rangeStart;
              const isEnd = cellValue === rangeEnd;
              const isEdge = isStart || isEnd;
              const isBetween = cellValue > rangeStart && cellValue < rangeEnd;
              const isToday = cellValue === todayValue;
              return (
                <div
                  key={cellValue}
                  // The span tint sits on the wrapper, not the day button, so
                  // consecutive days join into one continuous bar.
                  className={`flex h-8 items-center justify-center ${
                    isSpan && (isBetween || isEdge) ? "bg-[var(--color-selected-surface)]" : ""
                  } ${isSpan && isStart ? "rounded-l-full" : ""} ${isSpan && isEnd ? "rounded-r-full" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => selectDate(cellValue)}
                    onMouseEnter={() => setHovered(cellValue)}
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm tabular-nums transition-colors ${
                      isEdge
                        ? "bg-[var(--color-accent-primary)] font-semibold text-[var(--color-accent-contrast)]"
                        : inMonth
                          ? "text-[var(--color-text-primary)] hover:bg-[var(--color-page-bg)]"
                          : "text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)]"
                    } ${isToday && !isEdge ? "ring-1 ring-inset ring-[var(--color-accent-primary)]" : ""}`}
                  >
                    {date.getUTCDate()}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-center text-xs text-[var(--color-text-muted)]">
            {draftStart === null ? "Pick the start date." : `${formatDisplay(draftStart)} → pick the end date.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
