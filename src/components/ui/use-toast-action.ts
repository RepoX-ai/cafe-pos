"use client";

import { unstable_rethrow } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "./toast";

/**
 * Imperative counterpart to `ToastForm`, for the void server actions that
 * are now reached from an `ActionMenu` item rather than a submit button —
 * a menu item is a callback, not a form, so there is no `FormData` to
 * submit and nothing to catch a thrown permission/validation error.
 *
 * Same contract as `ToastForm`: the action's own `Error.message` becomes
 * the failure toast, and Next's internal redirect/notFound signals are
 * rethrown rather than swallowed.
 */
export function useToastAction() {
  const showToast = useToast();
  const [isPending, startTransition] = useTransition();

  function run(
    action: () => Promise<void>,
    messages: { success: string; error?: string },
  ) {
    startTransition(async () => {
      try {
        await action();
        showToast("success", messages.success);
      } catch (error) {
        unstable_rethrow(error);
        showToast(
          "error",
          error instanceof Error
            ? error.message
            : (messages.error ?? "Something went wrong. Please try again."),
        );
      }
    });
  }

  return { run, isPending };
}

/** Builds the `FormData` these actions still expect from a plain object. */
export function formDataOf(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}
