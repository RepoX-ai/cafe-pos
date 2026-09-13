"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName, textareaClassName } from "@/components/ui/form-styles";
import { updateSettingsAction, type SettingsActionState } from "./actions";
import { useActionResultToast } from "@/components/ui/use-action-toast";

export function SettingsForm({
  business,
  tax,
  serviceChargePercent,
}: {
  business: {
    name: string;
    receiptFooter: string | null;
    orderNumberPrefix: string;
    allowNegativeStock: boolean;
  };
  tax: { percent: number; inclusive: boolean } | null;
  serviceChargePercent: number | null;
}) {
  const [state, formAction, isPending] = useActionState<SettingsActionState, FormData>(
    updateSettingsAction,
    undefined,
  );
  const errorState = state && !state.ok ? state : undefined;
  useActionResultToast(state, "Settings saved.");

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--color-text-primary)]">Business</h2>
        <div className="flex flex-col gap-4">
          <Field label="Business name" htmlFor="name" error={errorState?.fieldErrors?.name}>
            <input id="name" name="name" defaultValue={business.name} required className={inputClassName} />
          </Field>
          <Field label="Order number prefix" htmlFor="orderNumberPrefix" error={errorState?.fieldErrors?.orderNumberPrefix}>
            <input
              id="orderNumberPrefix"
              name="orderNumberPrefix"
              defaultValue={business.orderNumberPrefix}
              required
              className={inputClassName + " max-w-[160px]"}
            />
          </Field>
          <Field label="Receipt footer" htmlFor="receiptFooter">
            <textarea id="receiptFooter" name="receiptFooter" defaultValue={business.receiptFooter ?? ""} className={textareaClassName} />
          </Field>
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Tax</h2>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Whether tax applies, and whether menu prices already include it, is a decision only the café owner can make (PRD §20).
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <Checkbox name="taxEnabled" defaultChecked={tax !== null} />
          Apply tax to orders
        </label>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tax percent" htmlFor="taxPercent">
            <input
              id="taxPercent"
              name="taxPercent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={tax?.percent ?? 11}
              className={inputClassName}
            />
          </Field>
          <Field label="Price basis" htmlFor="taxInclusive">
            <Select id="taxInclusive" name="taxInclusive" defaultValue={tax?.inclusive ? "on" : ""}>
              <option value="">Exclusive (tax added on top)</option>
              <option value="on">Inclusive (menu price already includes tax)</option>
            </Select>
          </Field>
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Service charge</h2>
        <label className="mb-3 mt-3 flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <Checkbox name="serviceChargeEnabled" defaultChecked={serviceChargePercent !== null} />
          Apply a service charge
        </label>
        <Field label="Service charge percent" htmlFor="serviceChargePercent">
          <input
            id="serviceChargePercent"
            name="serviceChargePercent"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={serviceChargePercent ?? 5}
            className={inputClassName + " max-w-[160px]"}
          />
        </Field>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Inventory behavior</h2>
        <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <Checkbox name="allowNegativeStock" defaultChecked={business.allowNegativeStock} />
          Allow orders to push stock negative (shows a warning instead of blocking submission)
        </label>
      </section>

      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState.error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
