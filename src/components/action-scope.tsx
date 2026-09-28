"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";

const ActionScopeContext = createContext<string | null>(null);

/**
 * Wrap a page's mutating UI in the scope its Server Component rendered it
 * for (`actionScopeFor(user)`). Provided per page, not in the dashboard
 * layout: a layout survives client navigation, so it would keep the old
 * café's scope after a switch and reject the new page's fresh forms.
 */
export function ActionScopeProvider({ scope, children }: { scope: string; children: ReactNode }) {
  return <ActionScopeContext.Provider value={scope}>{children}</ActionScopeContext.Provider>;
}

export function useActionScope(): string {
  const scope = useContext(ActionScopeContext);
  if (scope === null) throw new Error("This form needs an ActionScopeProvider from its page.");
  return scope;
}

/** Pre-binds the page's scope as the action's first argument. */
export function useScopedAction<Args extends unknown[], Result>(
  action: (expectedScope: string, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  const scope = useActionScope();
  return useMemo(() => action.bind(null, scope) as (...args: Args) => Promise<Result>, [action, scope]);
}

/**
 * `useActionState` for a scoped FormData action. Submits through onSubmit
 * rather than `<form action>`, because React resets a `<form action>` after
 * every submission — a rejected save (stale café, validation, rate limit)
 * would wipe what was typed. The form is reset only after a success.
 */
export function useScopedFormAction<State extends { ok: boolean } | undefined>(
  action: (expectedScope: string, prev: Awaited<State>, formData: FormData) => Promise<State>,
  initialState: Awaited<State>,
) {
  const bound = useScopedAction(action);
  const [state, dispatch, isPending] = useActionState<State, FormData>(bound, initialState);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if ((state as { ok: boolean } | undefined)?.ok) formRef.current?.reset();
  }, [state]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      formRef.current = event.currentTarget;
      const formData = new FormData(event.currentTarget);
      startTransition(() => dispatch(formData));
    },
    [dispatch],
  );

  return [state, onSubmit, isPending] as const;
}
