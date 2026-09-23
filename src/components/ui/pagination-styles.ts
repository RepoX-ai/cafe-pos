/** Shared by the client `Pagination` and the link-based `ServerPagination`. */
export function pageButtonClassName(active: boolean): string {
  const base =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-sm)] px-2 text-xs tabular-nums disabled:pointer-events-none disabled:opacity-40";
  return active
    ? `${base} bg-[var(--color-accent-primary)] font-medium text-[var(--color-accent-contrast)]`
    : `${base} text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]`;
}

export function pageSummary(shown: number, totalItems: number, cap?: number): string {
  // A count that stopped at the browse cap (see countUpTo) is a lower bound.
  const total = cap !== undefined && totalItems > cap ? `${cap.toLocaleString("id-ID")}+` : totalItems.toLocaleString("id-ID");
  return `Showing ${shown.toLocaleString("id-ID")} of ${total} ${totalItems === 1 ? "entry" : "entries"}`;
}
