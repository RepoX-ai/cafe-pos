"use client";

import { CheckCircle2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastVariant = "success" | "error";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

type ShowToast = (variant: ToastVariant, message: string) => void;

const ToastContext = createContext<ShowToast | null>(null);

const AUTO_DISMISS_MS = 5000;

/**
 * App-wide toast host. Mounted once in the root layout so every save,
 * archive, or mutation anywhere in the app can report success/failure —
 * see useToast() below, plus the higher-level useActionResultToast and
 * ToastForm helpers in this same directory for the two dominant call
 * patterns (useActionState forms, and fire-and-forget server actions).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback<ShowToast>(
    (variant, message) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, variant, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-[var(--radius-md)] border px-4 py-3 text-sm shadow-lg ${
              t.variant === "success"
                ? "border-[var(--color-success)]/30 bg-[var(--color-success-bg)] text-[var(--color-success)]"
                : "border-[var(--color-danger)]/30 bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
            }`}
          >
            {t.variant === "success" ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            ) : (
              <XCircle size={18} className="mt-0.5 shrink-0" />
            )}
            <p className="flex-1 font-medium">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Call directly for one-off, imperative success/error feedback. */
export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
