"use client";

import { formatIDR } from "@/lib/money/money";
import { useState } from "react";

export interface PieSlice {
  label: string;
  /** Whole-Rupiah amount the slice is sized by. */
  value: number;
  /** Secondary text shown in the centre on hover, e.g. "12 sold" or "4 orders". */
  caption: string;
  /** Never folded into "Other", however small. */
  pinned?: boolean;
}

/** Categorical tokens, assigned in this order — never cycled. */
const SLICE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];
const OTHER_COLOR = "var(--color-text-muted)";
const SIZE = 160;
const OUTER_RADIUS = SIZE / 2;
const THICKNESS = 20;
const INNER_RADIUS = OUTER_RADIUS - THICKNESS;
/** Hovered slice pushes outward by this much; the viewBox leaves room for it. */
const HOVER_GROW = 4;

/**
 * Keeps the five largest slices (pinned ones always among them) and folds the
 * rest into "Other", so the chart never needs more hues than the categorical
 * palette has.
 */
function foldSlices(data: PieSlice[]) {
  const positive = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (positive.length <= SLICE_COLORS.length + 1) {
    return positive.map((d, i) => ({ ...d, color: SLICE_COLORS[i] ?? OTHER_COLOR }));
  }
  const pinned = positive.filter((d) => d.pinned).slice(0, SLICE_COLORS.length);
  const unpinned = positive.filter((d) => !d.pinned);
  const keptSet = new Set([...pinned, ...unpinned.slice(0, SLICE_COLORS.length - pinned.length)]);
  const kept = positive.filter((d) => keptSet.has(d)).map((d, i) => ({ ...d, color: SLICE_COLORS[i] }));
  const rest = positive.filter((d) => !keptSet.has(d));
  return [
    ...kept,
    {
      label: "Other",
      value: rest.reduce((sum, d) => sum + d.value, 0),
      caption: `${rest.length} more`,
      color: OTHER_COLOR,
    },
  ];
}

function polar(radius: number, angle: number) {
  return `${OUTER_RADIUS + radius * Math.sin(angle)},${OUTER_RADIUS - radius * Math.cos(angle)}`;
}

function ringSegment(start: number, end: number, outer: number) {
  const largeArc = end - start > Math.PI ? 1 : 0;
  return [
    `M${polar(outer, start)}`,
    `A${outer},${outer} 0 ${largeArc} 1 ${polar(outer, end)}`,
    `L${polar(INNER_RADIUS, end)}`,
    `A${INNER_RADIUS},${INNER_RADIUS} 0 ${largeArc} 0 ${polar(INNER_RADIUS, start)}`,
    "Z",
  ].join(" ");
}

export function PieChart({
  data,
  ariaLabel,
  emptyText,
  totalLabel = "Total",
}: {
  data: PieSlice[];
  ariaLabel: string;
  emptyText: string;
  totalLabel?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const slices = foldSlices(data);
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return <p className="py-2 text-sm text-[var(--color-text-secondary)]">{emptyText}</p>;
  }

  const arcs = slices.map((slice, i) => {
    const before = slices.slice(0, i).reduce((sum, s) => sum + s.value, 0);
    const start = (before / total) * Math.PI * 2;
    const end = ((before + slice.value) / total) * Math.PI * 2;
    return { ...slice, start, end, percent: (slice.value / total) * 100 };
  });
  const active = hovered !== null ? arcs[hovered] : null;
  const pad = HOVER_GROW;

  return (
    <div className="flex flex-1 flex-col justify-center gap-4">
      <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`${-pad} ${-pad} ${SIZE + pad * 2} ${SIZE + pad * 2}`}
          width={SIZE + pad * 2}
          height={SIZE + pad * 2}
          className="absolute"
          style={{ top: -pad, left: -pad }}
          role="img"
          aria-label={ariaLabel}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Track behind the ring so the 2px gaps read as cuts, not holes. */}
          <circle
            cx={OUTER_RADIUS}
            cy={OUTER_RADIUS}
            r={OUTER_RADIUS - THICKNESS / 2}
            fill="none"
            stroke="var(--color-selected-surface)"
            strokeWidth={THICKNESS}
          />
          {arcs.map((arc, i) => {
            const isActive = hovered === i;
            const dimmed = hovered !== null && !isActive;
            const common = {
              fill: arc.color,
              opacity: dimmed ? 0.3 : 1,
              className: "cursor-pointer transition-opacity duration-150",
              onMouseEnter: () => setHovered(i),
              // Tap to toggle on touch screens, where there is no hover.
              onClick: () => setHovered(isActive ? null : i),
            };
            return arcs.length === 1 ? (
              <circle
                key={arc.label}
                cx={OUTER_RADIUS}
                cy={OUTER_RADIUS}
                r={OUTER_RADIUS - THICKNESS / 2}
                {...common}
                fill="none"
                stroke={arc.color}
                strokeWidth={THICKNESS}
              />
            ) : (
              <path
                key={arc.label}
                d={ringSegment(arc.start, arc.end, isActive ? OUTER_RADIUS + HOVER_GROW : OUTER_RADIUS)}
                stroke="var(--color-surface)"
                strokeWidth={2}
                strokeLinejoin="round"
                {...common}
              />
            );
          })}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-live="polite">
          <span className="max-w-[96px] truncate text-xs capitalize text-[var(--color-text-muted)]">
            {active ? active.label : totalLabel}
          </span>
          <span className="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">
            {formatIDR(active ? active.value : total)}
          </span>
          <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
            {active ? `${active.percent.toFixed(1)}% · ${active.caption}` : `${arcs.length} ${arcs.length === 1 ? "group" : "groups"}`}
          </span>
        </div>
      </div>

      {/* Names only — amount and share show in the ring's centre on hover/focus. */}
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {arcs.map((arc, i) => (
          <li
            key={arc.label}
            tabIndex={0}
            aria-label={`${arc.label}: ${formatIDR(arc.value)}, ${arc.percent.toFixed(1)}%, ${arc.caption}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            className={`flex cursor-default items-center gap-2 text-xs capitalize transition-colors duration-150 ${
              hovered === null || hovered === i ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"
            }`}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: arc.color }} aria-hidden />
            {arc.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
