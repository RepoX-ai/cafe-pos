"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
}: {
  options: BusinessOption[];
  activeMembershipId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();
  const showToast = useToast();

  function switchTo(membershipId: string) {
    if (membershipId === activeMembershipId || isPending) return;
    setBusyId(membershipId);
    startTransition(async () => {
      const result = await switchBusinessAction(membershipId);
      setBusyId(null);
      if (!result.ok) {
        showToast("error", result.error);
        return;
      }
      // Everything on screen belongs to the business we just left, so go
      // back to the landing route and let it re-resolve from scratch.
      router.replace("/");
      router.refresh();
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
            onClick={() => switchTo(option.membershipId)}
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
