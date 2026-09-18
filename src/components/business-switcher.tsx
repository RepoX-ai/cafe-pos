"use client";

import { useState, useTransition } from "react";
import { Check, Store } from "lucide-react";
import { switchBusinessAction } from "@/app/(auth)/switch-business/actions";
import { useToast } from "@/components/ui/toast";

export interface BusinessOption {
  membershipId: string;
  businessName: string;
  roleLabel: string;
}

/**
 * Lists the businesses this account belongs to and moves the session into
 * the chosen one. Rendered only when there is more than one — a café whose
 * staff each work at exactly one business never sees it.
 *
 * The list is presentational. Which businesses may be switched into is
 * decided server-side on every switch, so a tampered option value changes
 * nothing.
 */
export function BusinessSwitcher({
  options,
  activeMembershipId,
  onBeforeSwitch,
}: {
  options: BusinessOption[];
  activeMembershipId: string;
  /** Return false to cancel — the POS uses it to protect a cart in progress. */
  onBeforeSwitch?: (option: BusinessOption) => boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const showToast = useToast();

  function switchTo(option: BusinessOption) {
    const { membershipId } = option;
    if (membershipId === activeMembershipId || isPending) return;
    if (onBeforeSwitch && !onBeforeSwitch(option)) return;
    setBusyId(membershipId);
    startTransition(async () => {
      const result = await switchBusinessAction(membershipId);
      setBusyId(null);
      if (!result.ok) {
        showToast("error", result.error);
        return;
      }
      // A full load, not a client-side navigation: everything on screen
      // belongs to the business we just left, including the shell's logo
      // and accent, and re-rendering that tree on the client is what makes
      // React trip over next-themes' inline <script>. The landing route
      // re-resolves which screen this account should see.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a client-side push is exactly what we are avoiding here
      window.location.assign("/");
    });
  }

  return (
    <div role="group" aria-label="Switch business">
      <p className="px-3 pb-1 pt-2 text-xs font-medium text-[var(--color-text-muted)]">Businesses</p>
      {options.map((option) => {
        const isActive = option.membershipId === activeMembershipId;
        return (
          <button
            key={option.membershipId}
            type="button"
            role="menuitem"
            aria-current={isActive ? "true" : undefined}
            disabled={isPending}
            onClick={() => switchTo(option)}
            className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm font-medium disabled:opacity-60 ${
              isActive
                ? "bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)]"
            }`}
          >
            <Store size={16} className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.businessName}</span>
              <span className="block truncate text-xs font-normal text-[var(--color-text-muted)]">
                {busyId === option.membershipId ? "Switching…" : option.roleLabel}
              </span>
            </span>
            {isActive ? <Check size={16} className="shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}
