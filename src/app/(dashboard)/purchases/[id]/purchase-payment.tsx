"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/components/ui/toast";
import { updatePurchasePaymentAction } from "../actions";

export function PurchasePayment({ id, paidAt }: { id: string; paidAt: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [date, setDate] = useState(paidAt ?? new Date().toISOString().slice(0, 10));
  const [pending, setPending] = useState(false);

  async function update(next: string | null) {
    setPending(true);
    try {
      const result = await updatePurchasePaymentAction(id, next);
      if (!result.ok) {
        toast("error", result.error);
        return;
      }
      toast("success", next ? "Payment recorded." : "Payment confirmation removed.");
      router.refresh();
    } catch {
      toast("error", "Could not update payment. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-[180px]">
        <label htmlFor="purchase-paid-at" className="mb-1 block text-xs text-[var(--color-text-secondary)]">
          Payment date
        </label>
        <DatePicker id="purchase-paid-at" value={date} onChange={setDate} />
      </div>
      <Button size="sm" disabled={pending || !date} onClick={() => update(date)}>
        {pending ? "Saving…" : paidAt ? "Change date" : "Mark paid"}
      </Button>
      {paidAt ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => update(null)}>Clear payment</Button> : null}
    </div>
  );
}
