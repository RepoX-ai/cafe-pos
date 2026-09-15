"use client";

import type { ReactNode } from "react";
import { Pagination } from "@/components/ui/pagination";
import { usePagination } from "@/components/ui/use-pagination";

/**
 * Grouped reports pass every row and paginate here; row-level reports pass
 * one server-fetched page plus its `pagination` footer.
 */
export function ReportTable({
  columns,
  rows,
  pagination,
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  pagination?: ReactNode;
}) {
  const clientPage = usePagination(rows, 20);
  const visibleRows = pagination ? rows : clientPage.pageItems;

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              {columns.map((c) => (
                <th key={c} className="px-4 py-3">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                  No data for this range.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-4 py-3 ${j > 0 ? "tabular-nums text-[var(--color-text-secondary)]" : "text-[var(--color-text-primary)]"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination ?? (
        <Pagination
          page={clientPage.page}
          totalPages={clientPage.totalPages}
          totalItems={clientPage.totalItems}
          pageSize={clientPage.pageSize}
          onPageChange={clientPage.setPage}
        />
      )}
    </div>
  );
}
