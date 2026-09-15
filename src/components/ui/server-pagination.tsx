import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageHref, type Page } from "@/lib/pagination";

const controlClassName =
  "rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]";

/**
 * Footer for a list paginated on the server (`Page` from a service). Pages
 * are plain links carrying the list's filters in the URL, so every page is
 * shareable and survives a refresh. There is no total count — the service
 * only knows whether another page exists — so it shows the row range and
 * page number. Renders nothing when everything fits on the first page.
 */
export function ServerPagination({
  page,
  basePath,
  params = {},
}: {
  page: Pick<Page<unknown>, "page" | "pageSize" | "hasNextPage"> & { rowCount: number };
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (page.page === 1 && !page.hasNextPage) return null;

  const start = (page.page - 1) * page.pageSize + 1;
  const end = (page.page - 1) * page.pageSize + page.rowCount;

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2.5"
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
          `${start}–${end}`
        )}
      </span>
      <div className="flex items-center gap-1">
        {page.page > 1 ? (
          <Link href={pageHref(basePath, params, page.page - 1)} aria-label="Previous page" className={controlClassName}>
            <ChevronLeft size={16} />
          </Link>
        ) : (
          <span aria-hidden="true" className={`${controlClassName} pointer-events-none opacity-40`}>
            <ChevronLeft size={16} />
          </span>
        )}
        <span className="px-1 text-xs tabular-nums text-[var(--color-text-secondary)]">Page {page.page}</span>
        {page.hasNextPage ? (
          <Link href={pageHref(basePath, params, page.page + 1)} aria-label="Next page" className={controlClassName}>
            <ChevronRight size={16} />
          </Link>
        ) : (
          <span aria-hidden="true" className={`${controlClassName} pointer-events-none opacity-40`}>
            <ChevronRight size={16} />
          </span>
        )}
      </div>
    </nav>
  );
}
