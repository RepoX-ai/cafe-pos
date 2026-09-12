"use client";

import { formatIDR } from "@/lib/money/money";
import { useId, useState } from "react";

export interface SalesTrendPoint {
  /** Y-M-D, business timezone. */
  day: string;
  totalSales: number;
  orderCount: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatIDRCompact(n: number) {
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}jt`;
  if (n >= 1_000) return `Rp${Math.round(n / 1_000)}rb`;
  return `Rp${n}`;
}

function formatDayLabel(day: string) {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

function formatDayFull(day: string) {
  const [, m, d] = day.split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`;
}

const WIDTH = 480;
const HEIGHT = 210;
// Wide enough for the longest y-axis label ("Rp500rb") at 10px — narrower
// clipped its leading "R" against the SVG's left edge.
const PAD_LEFT = 56;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;
const TOOLTIP_WIDTH = 108;
const TOOLTIP_HEIGHT = 38;

export function SalesTrendChart({ data }: { data: SalesTrendPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId();

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotHeight;

  const maxValue = Math.max(...data.map((d) => d.totalSales), 1);
  // Round the axis ceiling up to a friendly step so gridline labels aren't jagged.
  const niceMax = niceCeiling(maxValue);

  const xAt = (i: number) => PAD_LEFT + (data.length > 1 ? (i / (data.length - 1)) * plotWidth : plotWidth / 2);
  const yAt = (value: number) => baseline - (value / niceMax) * plotHeight;
  const slotWidth = data.length > 0 ? plotWidth / data.length : plotWidth;

  const gridLines = [0, 0.5, 1];
  const hasAnySales = data.some((d) => d.totalSales > 0);

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.totalSales)}`).join(" ");
  const areaPath = data.length > 0 ? `${linePath} L${xAt(data.length - 1)},${baseline} L${xAt(0)},${baseline} Z` : "";

  const hoveredPoint = hovered !== null ? data[hovered] : null;
  let tooltipX = 0;
  let tooltipY = 0;
  if (hoveredPoint) {
    const px = xAt(hovered!);
    const py = yAt(hoveredPoint.totalSales);
    tooltipX = Math.min(Math.max(px - TOOLTIP_WIDTH / 2, PAD_LEFT), WIDTH - PAD_RIGHT - TOOLTIP_WIDTH);
    tooltipY = py - TOOLTIP_HEIGHT - 10;
    if (tooltipY < 0) tooltipY = py + 10; // flip below the point if it's too close to the top
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full overflow-visible"
        role="img"
        aria-label="Daily total sales for the last 14 days"
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
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD_LEFT - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-[var(--color-text-muted)]" fontSize={10}>
                {formatIDRCompact(niceMax * frac)}
              </text>
            </g>
          );
        })}

        {hasAnySales ? (
          <>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path d={linePath} fill="none" stroke="var(--color-accent-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        ) : (
          <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="fill-[var(--color-text-muted)]" fontSize={12}>
            No sales in the last 14 days.
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
                aria-label={`${point.day}: ${formatIDR(point.totalSales)}, ${point.orderCount} orders`}
              />
              {isHovered ? (
                <circle
                  cx={xAt(i)}
                  cy={yAt(point.totalSales)}
                  r={4}
                  fill="var(--color-accent-primary)"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  className="pointer-events-none"
                />
              ) : null}
              {data.length <= 7 || i % 3 === 0 || i === data.length - 1 ? (
                <text x={xAt(i)} y={HEIGHT - 6} textAnchor="middle" className="fill-[var(--color-text-muted)]" fontSize={9}>
                  {formatDayLabel(point.day)}
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
              {formatDayFull(hoveredPoint.day)}
            </text>
            <text x={tooltipX + 10} y={tooltipY + 29} className="fill-[var(--color-surface)]" fontSize={9.5} opacity={0.85}>
              {formatIDR(hoveredPoint.totalSales)} · {hoveredPoint.orderCount} orders
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
