/**
 * Offset pagination for growing historical lists. Pages fetch one extra row
 * to learn whether a next page exists, so no COUNT(*) is needed. Callers must
 * order by a unique tie-breaker (e.g. created_at, id) so rows never repeat or
 * vanish between pages.
 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * How deep an offset-paginated screen can go: the newest 10,000 rows of a
 * list. Each deeper page costs an OFFSET scan of every row before it (100k
 * ledger rows measured ~70 ms; the old cap allowed 2M), so older rows are
 * reached with the list's date filter or search, or the CSV export, instead.
 * List counts stop at this cap too — see `countUpTo`.
 */
export const MAX_BROWSABLE_ROWS = 10_000;
const MAX_PAGE = MAX_BROWSABLE_ROWS / DEFAULT_PAGE_SIZE;

export interface Page<T> {
  rows: T[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}

export function pageWindow(page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const safeSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const maxPage = Math.ceil(MAX_BROWSABLE_ROWS / safeSize);
  const safePage = Number.isInteger(page) && page >= 1 ? Math.min(page, maxPage) : 1;
  return { page: safePage, pageSize: safeSize, limit: safeSize + 1, offset: (safePage - 1) * safeSize };
}

/** Link to `page` of a list, keeping its other (non-empty) filters. Page 1 drops the param. */
export function pageHref(basePath: string, params: Record<string, string | undefined>, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `${basePath}?${search}` : basePath;
}

export function toPage<T>(rows: T[], page: number, pageSize: number): Page<T> {
  return { rows: rows.slice(0, pageSize), page, pageSize, hasNextPage: rows.length > pageSize };
}

export function totalPageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.min(totalItems, MAX_BROWSABLE_ROWS) / pageSize));
}

/**
 * Page buttons for a pager: every page when there are 7 or fewer, otherwise
 * the first and last page, the current page with its neighbours, and
 * "ellipsis" for each skipped run — always 7 slots so the control doesn't
 * change width while paging.
 */
export function pageNumbers(current: number, totalPages: number): Array<number | "ellipsis"> {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (totalPages <= 7) return range(1, totalPages);
  if (current <= 4) return [...range(1, 5), "ellipsis", totalPages];
  if (current >= totalPages - 3) return [1, "ellipsis", ...range(totalPages - 4, totalPages)];
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", totalPages];
}
