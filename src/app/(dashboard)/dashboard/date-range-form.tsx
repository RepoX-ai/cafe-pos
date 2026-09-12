"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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

export function DateRangeForm({ from, to, today }: { from: string; to: string; today: string }) {
  const router = useRouter();
  const [preset, setPreset] = useState<Preset>(() => detectPreset(from, to, today));

  function applyPreset(daysBack: number, key: Exclude<Preset, "custom">) {
    setPreset(key);
    const nextFrom = shiftBusinessDate(today, -daysBack);
    router.push(`/dashboard?from=${nextFrom}&to=${today}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
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
        <form action="/dashboard" className="flex items-end gap-2">
          <div>
            <label htmlFor="from" className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
              From
            </label>
            <DatePicker id="from" name="from" defaultValue={from} className="w-[160px]" />
          </div>
          <div>
            <label htmlFor="to" className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
              To
            </label>
            <DatePicker id="to" name="to" defaultValue={to} className="w-[160px]" />
          </div>
          <Button type="submit">Apply</Button>
        </form>
      ) : null}
    </div>
  );
}
