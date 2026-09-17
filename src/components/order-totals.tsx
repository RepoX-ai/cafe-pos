import type { ReactNode } from "react";

export function TotalsPanel({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="self-start overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full border-collapse text-sm">
        <caption className="border-b border-[var(--color-border)] px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          {caption}
        </caption>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function TotalsRow({
  label,
  value,
  emphasis = false,
  muted = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <tr
      className={
        emphasis
          ? "border-t border-[var(--color-text-primary)]"
          : "border-t border-[var(--color-border)] first:border-t-0"
      }
    >
      <th
        scope="row"
        className={`px-4 py-2.5 text-left ${
          emphasis ? "font-semibold text-[var(--color-text-primary)]" : "font-normal text-[var(--color-text-secondary)]"
        }`}
      >
        {label}
      </th>
      <td
        className={`px-4 py-2.5 text-right tabular-nums ${
          emphasis
            ? "font-semibold text-[var(--color-text-primary)]"
            : muted
              ? "text-[var(--color-text-secondary)]"
              : "text-[var(--color-text-primary)]"
        }`}
      >
        {value}
      </td>
    </tr>
  );
}
