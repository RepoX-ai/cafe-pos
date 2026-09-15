/**
 * Offset pagination for growing historical lists. Pages fetch one extra row
 * to learn whether a next page exists, so no COUNT(*) is needed. Callers must
 * order by a unique tie-breaker (e.g. created_at, id) so rows never repeat or
 * vanish between pages.
 */
export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 100_000;

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
  const safePage = Number.isInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
  const safeSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
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
