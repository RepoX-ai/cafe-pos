"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

// Admin-only theme control (PRD: dark mode is for admin users). Lives in
// AdminShell's top-right header, styled after the existing Dine-in/Takeaway
// segmented control in the POS so it reads as the same design language.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The persisted preference isn't known during SSR — next-themes resolves
  // it client-side only. Render the neutral "system" state until then to
  // avoid a hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const current = mounted ? (theme ?? "system") : "system";

  return (
    <div className="flex gap-1 rounded-[var(--radius-sm)] bg-[var(--color-page-bg)] p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          title={label}
          aria-label={label}
          aria-pressed={current === value}
          className={`flex items-center justify-center rounded-[calc(var(--radius-sm)-2px)] p-1.5 ${
            current === value
              ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
