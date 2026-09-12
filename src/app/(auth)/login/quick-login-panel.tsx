"use client";

import { useState, useTransition } from "react";
import { DEV_SEED_ACCOUNTS } from "@/lib/dev-seed-accounts";
import { ROLE_LABELS } from "@/lib/permissions/role-labels";
import { devQuickLoginAction } from "./actions";

/**
 * One-click sign-in for the seeded dev accounts, right on the login
 * screen — the obvious place to look for it. Dev-only: the server action
 * behind this refuses to run in production regardless of what calls it,
 * so this can never work even if a build somehow shipped the markup.
 */
export function QuickLoginPanel() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  function signInAs(email: string) {
    setError(null);
    setPendingEmail(email);
    startTransition(async () => {
      const result = await devQuickLoginAction(email);
      if (result?.error) setError(result.error);
      setPendingEmail(null);
    });
  }

  return (
    <div className="mt-6 border-t border-[var(--color-border)] pt-5">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
        Dev quick sign-in
      </p>
      <div className="grid grid-cols-2 gap-2">
        {DEV_SEED_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            onClick={() => signInAs(account.email)}
            disabled={isPending}
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent-primary)] hover:bg-[var(--color-selected-surface)] disabled:opacity-50"
          >
            {isPending && pendingEmail === account.email ? "Signing in…" : ROLE_LABELS[account.role]}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
