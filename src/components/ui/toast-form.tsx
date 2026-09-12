"use client";

import { unstable_rethrow } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { useToast } from "./toast";

/**
 * Drop-in replacement for `<form action={someVoidServerAction}>` — used for
 * the many quick fire-and-forget mutations across the dashboard (archive /
 * restore toggles, enable / disable switches) whose server action returns
 * `Promise<void>` and gives the caller no way to know whether it worked.
 *
 * Submits the same `FormData` the native form would, but calls the action
 * directly so the outcome (including a thrown permission or validation
 * error) becomes a toast instead of either no feedback at all (success) or
 * an unhandled server exception (failure).
 */
export function ToastForm({
  action,
  successMessage = "Saved.",
  errorMessage = "Something went wrong. Please try again.",
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  successMessage?: string;
  errorMessage?: string;
  className?: string;
  children: ReactNode;
}) {
  const showToast = useToast();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            await action(formData);
            showToast("success", successMessage);
          } catch (error) {
            // Actions in this pattern don't redirect today, but rethrow
            // Next's internal redirect/notFound signals just in case one
            // starts to — they must never be swallowed as a real error.
            unstable_rethrow(error);
            showToast("error", error instanceof Error ? error.message : errorMessage);
          }
        });
      }}
    >
      <fieldset disabled={isPending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
