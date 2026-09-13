"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="identifier" className="text-sm font-medium text-[var(--color-text-primary)]">
          Email
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          className="h-11 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[15px] text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent-primary)]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-[var(--color-text-primary)]">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[15px] text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent-primary)]"
        />
      </div>

      {state?.error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="h-11 rounded-[var(--radius-sm)] bg-[var(--color-accent-primary)] text-sm font-semibold text-[var(--color-accent-contrast)] transition-opacity hover:opacity-90 disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)]"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
