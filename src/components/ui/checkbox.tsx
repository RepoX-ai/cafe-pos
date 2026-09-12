import { forwardRef, type InputHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          className={cn(
            "peer h-4 w-4 shrink-0 appearance-none rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors checked:border-[var(--color-accent-primary)] checked:bg-[var(--color-accent-primary)] hover:enabled:border-[var(--color-accent-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-primary)] disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <Check
          size={12}
          strokeWidth={3}
          className="pointer-events-none absolute text-[var(--color-accent-contrast)] opacity-0 peer-checked:opacity-100"
        />
      </span>
    );
  },
);
