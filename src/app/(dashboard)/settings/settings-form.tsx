"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClassName, textareaClassName } from "@/components/ui/form-field";
import { updateSettingsAction, type SettingsActionState } from "./actions";

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
          <input type="checkbox" name="taxEnabled" defaultChecked={tax !== null} />
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
            <select id="taxInclusive" name="taxInclusive" defaultValue={tax?.inclusive ? "on" : ""} className={inputClassName}>
              <option value="">Exclusive (tax added on top)</option>
              <option value="on">Inclusive (menu price already includes tax)</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">Service charge</h2>
        <label className="mb-3 mt-3 flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <input type="checkbox" name="serviceChargeEnabled" defaultChecked={serviceChargePercent !== null} />
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
          <input type="checkbox" name="allowNegativeStock" defaultChecked={business.allowNegativeStock} />
          Allow orders to push stock negative (shows a warning instead of blocking submission)
        </label>
      </section>

      {errorState?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
          {errorState.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="rounded-[var(--radius-sm)] bg-[#E7F8EF] px-3 py-2 text-sm text-[var(--color-success)]">
          Settings saved.
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
