import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-[var(--color-page-bg)] text-[var(--color-text-secondary)]",
  success: "bg-[#E7F8EF] text-[var(--color-success)]",
  warning: "bg-[#FEF2E3] text-[var(--color-warning)]",
  danger: "bg-[#FEF3F2] text-[var(--color-danger)]",
  accent: "bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}
