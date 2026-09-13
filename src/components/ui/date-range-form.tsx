"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { shiftBusinessDate } from "@/lib/dates/dates";

type Preset = "daily" | "weekly" | "monthly" | "custom";

const PRESETS: { key: Exclude<Preset, "custom">; label: string; daysBack: number }[] = [
  { key: "daily", label: "Daily", daysBack: 0 },
  { key: "weekly", label: "Weekly", daysBack: 6 },
  { key: "monthly", label: "Monthly", daysBack: 29 },
];

/** Which preset (if any) the current from/to range matches, so a page reload or shared link highlights the right pill instead of always falling back to Custom. */
function detectPreset(from: string, to: string, today: string): Preset {
  if (to !== today) return "custom";
  const preset = PRESETS.find((p) => from === shiftBusinessDate(today, -p.daysBack));
  return preset?.key ?? "custom";
}

function pillClassName(active: boolean) {
  return `h-10 rounded-full border px-4 text-sm font-medium transition-colors ${
    active
      ? "border-[var(--color-accent-primary)] bg-[var(--color-accent-primary)] text-[var(--color-accent-contrast)]"
      : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent-primary)] hover:text-[var(--color-text-primary)]"
  }`;
}

export function DateRangeForm({
  from,
  to,
  today,
  basePath,
}: {
  from: string;
  to: string;
  today: string;
  /** Route the presets and the custom range picker navigate to. */
  basePath: string;
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset>(() => detectPreset(from, to, today));

  function applyPreset(daysBack: number, key: Exclude<Preset, "custom">) {
    setPreset(key);
    const nextFrom = shiftBusinessDate(today, -daysBack);
    router.push(`${basePath}?from=${nextFrom}&to=${today}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => applyPreset(p.daysBack, p.key)}
            className={pillClassName(preset === p.key)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreset("custom")}
          className={pillClassName(preset === "custom")}
        >
          Custom
        </button>
      </div>

      {preset === "custom" ? (
        <DateRangePicker
          from={from}
          to={to}
          onApply={(range) => router.push(`${basePath}?from=${range.from}&to=${range.to}`)}
        />
      ) : null}
    </div>
  );
}
