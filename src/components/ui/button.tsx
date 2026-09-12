import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] text-sm font-medium transition-colors disabled:pointer-events-none disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        // Disabled state swaps to explicit neutral colors rather than fading
        // via opacity: fading white text on a solid fill toward a near-white
        // page background collapses the text/background contrast almost to
        // nothing (verified ~2.6:1, well under WCAG's 4.5:1) — a solid muted
        // gray reads as "disabled" without going unreadable.
        primary:
          "bg-[var(--color-accent-primary)] text-[var(--color-accent-contrast)] hover:opacity-90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)]",
        secondary:
          "border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-selected-surface)] disabled:opacity-60",
        danger:
          "bg-[var(--color-danger)] text-white hover:opacity-90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)]",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        // Matches inputClassName / Select / DatePicker's h-10 so a default
        // button sitting next to a text field in the same row lines up
        // instead of sitting 4px shorter.
        md: "h-10 px-3.5",
        lg: "h-11 px-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
