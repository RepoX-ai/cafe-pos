"use client";

import { formatIDR } from "@/lib/money/money";
import { useEffect, useId, useRef, useState } from "react";

export interface TrendPoint {
  /** Y-M-D, business timezone. */
  day: string;
  /** The plotted Rupiah amount. */
  value: number;
  /** Secondary line in the tooltip, e.g. "3 orders" or "2 entries". */
  caption: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatIDRCompact(n: number) {
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}jt`;
  if (n >= 1_000) return `Rp${Math.round(n / 1_000)}rb`;
  return `Rp${n}`;
}

/** How the points were bucketed; `day` is each bucket's first date. */
export type TrendGranularity = "day" | "week" | "month";

function formatDayLabel(day: string, granularity: TrendGranularity) {
  const [y, m, d] = day.split("-");
  if (granularity === "month") return `${MONTHS[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  return `${d}/${m}`;
}

function formatDayFull(day: string, granularity: TrendGranularity) {
  const [y, m, d] = day.split("-");
  if (granularity === "month") return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
  const date = `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`;
  return granularity === "week" ? `Week of ${date}` : date;
}

/** Fallback width for the first paint, before the container is measured. */
const FALLBACK_WIDTH = 480;
const HEIGHT = 210;
// Axis labels sit on the 12px step of the type scale — the smallest standard
// size — now that one SVG user unit renders as one CSS pixel.
const AXIS_FONT_SIZE = 12;
// Wide enough for the longest y-axis label ("Rp500rb") at 12px — narrower
// clipped its leading "R" against the SVG's left edge.
const PAD_LEFT = 64;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
// Room for a 12px day label below the baseline.
const PAD_BOTTOM = 28;
const TOOLTIP_WIDTH = 108;
const TOOLTIP_HEIGHT = 38;

export function TrendChart({
  data,
  ariaLabel,
  emptyText,
  granularity = "day",
}: {
  data: TrendPoint[];
  ariaLabel: string;
  emptyText: string;
  granularity?: TrendGranularity;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId();

  // The viewBox tracks the container's real pixel width and the SVG keeps a
  // fixed pixel height, so one user unit is always one CSS pixel. Without this
  // a `w-full` SVG on a fixed viewBox scales uniformly — a wider card would
  // stretch the chart taller and blow up every label with it.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width;
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotHeight;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  // Round the axis ceiling up to a friendly step so gridline labels aren't jagged.
  const niceMax = niceCeiling(maxValue);

  const xAt = (i: number) => PAD_LEFT + (data.length > 1 ? (i / (data.length - 1)) * plotWidth : plotWidth / 2);
  const yAt = (value: number) => baseline - (value / niceMax) * plotHeight;
  const slotWidth = data.length > 0 ? plotWidth / data.length : plotWidth;

  const gridLines = [0, 0.5, 1];
  const hasAnyValue = data.some((d) => d.value > 0);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.value)}`).join(" ");
  const areaPath = data.length > 0 ? `${linePath} L${xAt(data.length - 1)},${baseline} L${xAt(0)},${baseline} Z` : "";

  const hoveredPoint = hovered !== null ? data[hovered] : null;
  let tooltipX = 0;
  let tooltipY = 0;
  if (hoveredPoint) {
    const px = xAt(hovered!);
    const py = yAt(hoveredPoint.value);
    tooltipX = Math.min(Math.max(px - TOOLTIP_WIDTH / 2, PAD_LEFT), width - PAD_RIGHT - TOOLTIP_WIDTH);
    tooltipY = py - TOOLTIP_HEIGHT - 10;
    if (tooltipY < 0) tooltipY = py + 10; // flip below the point if it's too close to the top
  }

  return (
    <div ref={containerRef}>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        className="overflow-visible"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent-primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-accent-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((frac) => {
          const y = baseline - frac * plotHeight;
          return (
            <g key={frac}>
              <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text
                x={PAD_LEFT - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-[var(--color-text-muted)]"
                fontSize={AXIS_FONT_SIZE}
              >
                {formatIDRCompact(niceMax * frac)}
              </text>
            </g>
          );
        })}

        {hasAnyValue ? (
          <>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path d={linePath} fill="none" stroke="var(--color-accent-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        ) : (
          <text x={width / 2} y={HEIGHT / 2} textAnchor="middle" className="fill-[var(--color-text-muted)]" fontSize={12}>
            {emptyText}
          </text>
        )}

        {hovered !== null ? (
          <line
            x1={xAt(hovered)}
            x2={xAt(hovered)}
            y1={PAD_TOP}
            y2={baseline}
            stroke="var(--color-text-muted)"
            strokeWidth={1}
            strokeDasharray="2,2"
            className="pointer-events-none"
          />
        ) : null}

        {data.map((point, i) => {
          const isHovered = hovered === i;
          return (
            <g key={point.day}>
              {/* Per-point hit target, wider than the line itself so hover works between/near points too. */}
              <rect
                x={xAt(i) - slotWidth / 2}
                y={PAD_TOP}
                width={slotWidth}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onFocus={() => setHovered(i)}
                tabIndex={0}
                aria-label={`${point.day}: ${formatIDR(point.value)}, ${point.caption}`}
              />
              {isHovered ? (
                <circle
                  cx={xAt(i)}
                  cy={yAt(point.value)}
                  r={4}
                  fill="var(--color-accent-primary)"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  className="pointer-events-none"
                />
              ) : null}
              {data.length <= 7 || i % 3 === 0 || i === data.length - 1 ? (
                <text
                  x={xAt(i)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-[var(--color-text-muted)]"
                  fontSize={AXIS_FONT_SIZE}
                >
                  {formatDayLabel(point.day, granularity)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* On-chart tooltip, anchored above (or below, near the top edge) the hovered point. */}
        {hoveredPoint ? (
          <g className="pointer-events-none">
            <rect
              x={tooltipX}
              y={tooltipY}
              width={TOOLTIP_WIDTH}
              height={TOOLTIP_HEIGHT}
              rx={6}
              fill="var(--color-text-primary)"
              opacity={0.95}
            />
            <text x={tooltipX + 10} y={tooltipY + 15} className="fill-[var(--color-surface)]" fontSize={10} fontWeight={600}>
              {formatDayFull(hoveredPoint.day, granularity)}
            </text>
            <text x={tooltipX + 10} y={tooltipY + 29} className="fill-[var(--color-surface)]" fontSize={9.5} opacity={0.85}>
              {formatIDR(hoveredPoint.value)} · {hoveredPoint.caption}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/** Round up to a clean gridline ceiling (1/2/5 × a power of 10). */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}
