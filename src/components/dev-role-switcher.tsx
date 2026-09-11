"use client";

import { useState, useTransition } from "react";
import { DEV_SEED_ACCOUNTS } from "@/lib/dev-seed-accounts";
import { ROLE_LABELS } from "@/lib/permissions/role-labels";
import { devQuickLoginAction } from "@/app/(auth)/login/actions";

/**
 * Dev-only one-click account switcher — jump between seeded roles
 * (Owner/Admin <-> Cashier, etc.) without typing credentials or manually
 * logging out first. Rendered from the root layout, but only outside
 * production; the server action it calls refuses to run in production
 * regardless, so this can never work if a build somehow shipped it.
 */
export function DevRoleSwitcher({ currentEmail }: { currentEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function switchTo(email: string) {
    setError(null);
    startTransition(async () => {
      const result = await devQuickLoginAction(email);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="fixed bottom-4 right-4 z-[100] font-sans">
      {open ? (
        <div className="mb-2 w-64 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg">
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Dev: switch account
          </p>
          <div className="flex flex-col gap-0.5">
            {DEV_SEED_ACCOUNTS.map((account) => {
              const active = account.email === currentEmail;
              return (
                <button
                  key={account.email}
                  onClick={() => switchTo(account.email)}
                  disabled={isPending || active}
                  className={`flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm transition-colors ${
                    active
                      ? "bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                      : "text-[var(--color-text-primary)] hover:bg-[var(--color-page-bg)] disabled:opacity-50"
                  }`}
                >
                  <span>{ROLE_LABELS[account.role]}</span>
                  {active ? <span className="text-xs">current</span> : null}
                </button>
              );
            })}
          </div>
          {error ? <p className="px-2 pt-1.5 text-xs text-[var(--color-danger)]">{error}</p> : null}
        </div>
      ) : null}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch dev account"
        className="flex h-10 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium text-[var(--color-text-primary)] shadow-lg hover:bg-[var(--color-page-bg)]"
      >
        🛠️ Dev {open ? "▾" : "▸"}
      </button>
    </div>
  );
}
