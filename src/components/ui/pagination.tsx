"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageNumbers } from "@/lib/pagination";
import { pageButtonClassName, pageSummary } from "./pagination-styles";

/**
 * Footer control for a paginated table — pair with `usePagination`. Renders
 * nothing when everything fits on one page, so callers can always mount it
 * unconditionally below a table body.
 */
export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const shown = Math.max(0, Math.min(pageSize, totalItems - (page - 1) * pageSize));

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-4 py-2.5">
      <span className="text-xs text-[var(--color-text-muted)]">{pageSummary(shown, totalItems)}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={pageButtonClassName(false)}
        >
          <ChevronLeft size={16} />
        </button>
        {pageNumbers(page, totalPages).map((n, i) =>
          n === "ellipsis" ? (
            <span key={`e${i}`} aria-hidden="true" className="px-1 text-xs text-[var(--color-text-muted)]">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => onPageChange(n)}
              aria-label={`Page ${n}`}
              aria-current={n === page ? "page" : undefined}
              className={pageButtonClassName(n === page)}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className={pageButtonClassName(false)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  );
}
