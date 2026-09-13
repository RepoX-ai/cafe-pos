"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cancelOrderAction, refundOrderAction, type CancelOrderResult } from "../actions";
import { useToast } from "@/components/ui/toast";

export function OrderActionButton({
  orderId,
  kind,
}: {
  orderId: string;
  kind: "cancel" | "refund";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showToast = useToast();

  const action: (input: unknown) => Promise<CancelOrderResult> = kind === "cancel" ? cancelOrderAction : refundOrderAction;
  const label = kind === "cancel" ? "Cancel order" : "Refund order";
  const warning =
    kind === "cancel"
      ? "This reverses inventory consumption and cannot be undone."
      : "This is a full refund — it reverses inventory consumption and cannot be undone.";

  async function submit() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setIsPending(true);
    setError(null);
    const result = await action({ orderId, reason });
    setIsPending(false);
    if (!result.ok) {
      setError(result.error);
      showToast("error", result.error);
      return;
    }
    showToast("success", kind === "cancel" ? "Order cancelled." : "Order refunded.");
    setOpen(false);
  }

  if (!open) {
    return (
      <Button variant="danger" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-bg)] p-4">
      <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
        {warning} A reason is required.
      </p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`${label} reason`}
        className="mb-2 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm outline-none"
      />
      {error ? <p className="mb-2 text-sm text-[var(--color-danger)]">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Back
        </Button>
        <Button variant="danger" onClick={submit} disabled={isPending}>
          {isPending ? "Working…" : `Confirm ${label.toLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}
