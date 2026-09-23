import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MAX_BROWSABLE_ROWS, pageHref, pageNumbers, totalPageCount } from "@/lib/pagination";
import { pageButtonClassName, pageSummary } from "./pagination-styles";

/**
 * Footer for a list paginated on the server. Pages are plain links carrying
 * the list's filters in the URL, so every page is shareable and survives a
 * refresh. `totalItems` comes from a COUNT over the same filters as the page
 * query. Renders nothing when everything fits on the first page.
 */
export function ServerPagination({
  page,
  totalItems,
  basePath,
  params = {},
}: {
  page: { page: number; pageSize: number; rowCount: number };
  totalItems: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const totalPages = totalPageCount(totalItems, page.pageSize);
  if (page.page === 1 && totalPages <= 1) return null;

  const current = page.page;
  const disabled = `${pageButtonClassName(false)} pointer-events-none opacity-40`;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-4 py-2.5"
    >
      <span className="text-xs text-[var(--color-text-muted)]">
        {page.rowCount === 0 ? (
          <>
            No results on this page.{" "}
            <Link href={pageHref(basePath, params, 1)} className="text-[var(--color-accent-primary)] hover:underline">
              Go to the first page
            </Link>
          </>
        ) : (
          pageSummary(page.rowCount, totalItems, MAX_BROWSABLE_ROWS)
        )}
      </span>
      <div className="flex items-center gap-1">
        {current > 1 ? (
          <Link href={pageHref(basePath, params, Math.min(current - 1, totalPages))} aria-label="Previous page" className={pageButtonClassName(false)}>
            <ChevronLeft size={16} />
          </Link>
        ) : (
          <span aria-hidden="true" className={disabled}>
            <ChevronLeft size={16} />
          </span>
        )}
        {pageNumbers(current, totalPages).map((n, i) =>
          n === "ellipsis" ? (
            <span key={`e${i}`} aria-hidden="true" className="px-1 text-xs text-[var(--color-text-muted)]">
              …
            </span>
          ) : (
            <Link
              key={n}
              href={pageHref(basePath, params, n)}
              aria-label={`Page ${n}`}
              aria-current={n === current ? "page" : undefined}
              className={pageButtonClassName(n === current)}
            >
              {n}
            </Link>
          ),
        )}
        {current < totalPages ? (
          <Link href={pageHref(basePath, params, current + 1)} aria-label="Next page" className={pageButtonClassName(false)}>
            <ChevronRight size={16} />
          </Link>
        ) : (
          <span aria-hidden="true" className={disabled}>
            <ChevronRight size={16} />
          </span>
        )}
      </div>
    </nav>
  );
}
