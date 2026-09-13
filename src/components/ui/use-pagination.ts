"use client";

import { useMemo, useState } from "react";

/**
 * Client-side pagination over an already-fetched array. `page` is always
 * clamped to `[1, totalPages]` at read time — a `requestedPage` beyond the
 * current bounds (e.g. after a filter shrinks the list) just displays
 * clamped, no effect needed to correct it back.
 */
export function usePagination<T>(items: T[], pageSize = 20) {
  const [requestedPage, setRequestedPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return { page, setPage: setRequestedPage, totalPages, pageItems, pageSize, totalItems: items.length };
}
