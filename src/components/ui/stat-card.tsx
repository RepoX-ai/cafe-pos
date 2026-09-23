import { ArrowDown, ArrowUp } from "lucide-react";

export interface Trend {
  pct: number;
  up: boolean;
}

/**
 * Percent change vs. the immediately preceding period of equal length. A
 * previous value of 0 can't produce a ratio, so a rise from 0 reads as a
 * flat +100% (matches how the comparison badge is understood elsewhere in
 * the app) rather than an undefined/Infinity percentage.
 */
export function computeTrend(current: number, previous: number): Trend | null {
  if (previous === 0) return current > 0 ? { pct: 100, up: true } : null;
  const pct = ((current - previous) / previous) * 100;
  if (pct === 0) return null;
  return { pct: Math.round(Math.abs(pct)), up: pct > 0 };
}

export function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  emphasize,
  trend,
  previousLabel,
  trendMeansGood = true,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  tone?: "danger" | "warning";
  emphasize?: boolean;
  trend?: Trend | null;
  previousLabel?: string;
  /** For cost-style metrics a rise is bad, so the arrow colours invert. */
  trendMeansGood?: boolean;
}) {
  const color =
    tone === "danger" ? "text-[var(--color-danger)]" : tone === "warning" ? "text-[var(--color-warning)]" : "text-[var(--color-text-primary)]";
  const trendIsPositive = trend ? trend.up === trendMeansGood : false;
  return (
    <div
      className={`rounded-[var(--radius-md)] border p-4 ${
        emphasize
          ? "border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
        <Icon size={14} className="shrink-0 text-[var(--color-text-muted)]" />
      </div>
      {/* All card numbers share one size/weight so the row reads as one set — emphasis is by
          border/background above, not a bigger number. */}
      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-2">
        <p className={`min-w-0 break-all text-xl font-semibold tabular-nums ${color}`}>{value}</p>
        {trend ? (
          <span
            className={`flex items-center gap-0.5 text-xs font-medium tabular-nums ${
              trendIsPositive ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
            }`}
          >
            {trend.up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {trend.pct}%
          </span>
        ) : null}
      </div>
      {previousLabel ? <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{previousLabel}</p> : null}
    </div>
  );
}
