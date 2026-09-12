"use client";

import { useEffect, useRef } from "react";
import { useToast } from "./toast";

/**
 * Structural shape shared by every `FormActionState` across the dashboard's
 * `actions.ts` files — kept generic here rather than importing one specific
 * module's type.
 */
export type ActionResultState = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> } | undefined;

/**
 * Toasts the outcome of a `useActionState`-bound form the moment its state
 * settles to a result. Drop into any form component that already does
 * `const [state, formAction, isPending] = useActionState(...)`.
 *
 * Actions that redirect on success (e.g. creating an item and navigating to
 * its detail page) never resolve to `{ok:true}` on this component — the
 * navigation itself is the success signal there, so there's nothing to
 * toast.
 */
export function useActionResultToast(state: ActionResultState, successMessage = "Saved.") {
  const showToast = useToast();
  const lastSeen = useRef<ActionResultState>(undefined);

  useEffect(() => {
    if (state === lastSeen.current) return;
    lastSeen.current = state;
    if (state === undefined) return;
    if (state.ok) showToast("success", successMessage);
    else showToast("error", state.error);
  }, [state, successMessage, showToast]);
}
