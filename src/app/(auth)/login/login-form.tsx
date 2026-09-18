"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loginAction } from "./actions";

export function LoginForm({ rememberedEmail }: { rememberedEmail: string }) {
  const [state, formAction, isPending] = useActionState(loginAction, undefined);
  const [showPassword, setShowPassword] = useState(false);

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
          defaultValue={rememberedEmail}
          autoFocus={!rememberedEmail}
          required
          className="h-11 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[15px] text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent-primary)]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-[var(--color-text-primary)]">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoFocus={Boolean(rememberedEmail)}
            required
            className="h-11 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-3 pr-11 text-[15px] text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent-primary)]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="password"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:text-[var(--color-text-primary)]"
          >
            {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <input
          type="checkbox"
          name="remember"
          defaultChecked={Boolean(rememberedEmail)}
          className="size-4 accent-[var(--color-accent-primary)]"
        />
        Remember my email on this device
      </label>

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
