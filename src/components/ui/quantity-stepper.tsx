"use client";

import { Minus, Plus } from "lucide-react";

interface QuantityStepperProps {
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  /** sm: compact, for a dense list row (POS cart line). lg: prominent, for a modal footer next to a size="lg" Button. */
  size?: "sm" | "lg";
}

const SIZES = {
  sm: { button: "h-7 w-7", icon: 13, value: "w-5 text-center text-sm tabular-nums" },
  lg: { button: "h-10 w-10", icon: 16, value: "w-6 text-center text-base font-semibold tabular-nums" },
} as const;

export function QuantityStepper({ value, onDecrease, onIncrease, size = "lg" }: QuantityStepperProps) {
  const s = SIZES[size];
  const buttonClassName = `flex ${s.button} items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-primary)]`;

  return (
    <>
      <button type="button" onClick={onDecrease} className={buttonClassName} aria-label="Decrease quantity">
        <Minus size={s.icon} />
      </button>
      <span className={`${s.value} text-[var(--color-text-primary)]`}>{value}</span>
      <button type="button" onClick={onIncrease} className={buttonClassName} aria-label="Increase quantity">
        <Plus size={s.icon} />
      </button>
    </>
  );
}
