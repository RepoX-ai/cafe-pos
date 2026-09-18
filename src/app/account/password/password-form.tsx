"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation/account";
import { changePasswordAction, type ChangePasswordState } from "./actions";

export function PasswordForm() {
  const [state, formAction, isPending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, undefined);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-[var(--radius-sm)] bg-[var(--color-success-bg)] px-3 py-2 text-sm text-[var(--color-success)]">
          Password changed. You&apos;re still signed in here; other devices have been signed out.
        </p>
        <Link href="/" className="text-sm font-medium text-[var(--color-accent-primary)] hover:underline">
          Back to the app
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Field label="Current password" htmlFor="currentPassword" error={errors?.currentPassword}>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={inputClassName}
        />
      </Field>
      <Field label="New password" htmlFor="newPassword" error={errors?.newPassword}>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          className={inputClassName}
        />
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">At least {MIN_PASSWORD_LENGTH} characters.</p>
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" error={errors?.confirmPassword}>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={inputClassName}
        />
      </Field>

      {state && !state.ok && !state.fieldErrors ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="mt-2">
        {isPending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
