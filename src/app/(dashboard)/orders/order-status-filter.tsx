"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Select } from "@/components/ui/form-field";

const STATUSES = ["SUBMITTED", "PRINT_PENDING", "PRINTED", "COMPLETED", "CANCELLED", "REFUNDED"];

/**
 * Status dropdown that applies itself on change. Reads the rest of the
 * enclosing form (the order-number search) so changing status keeps
 * whatever is typed there. The new value is passed in explicitly rather
 * than via requestSubmit(), because Select's hidden input only updates on
 * the next render and would still hold the previous status.
 */
export function OrderStatusFilter({ status }: { status: string }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  function applyStatus(value: string) {
    const form = rootRef.current?.closest("form");
    const params = new URLSearchParams();
    const search = form ? new FormData(form).get("search") : null;
    if (typeof search === "string" && search.trim()) params.set("search", search.trim());
    if (value) params.set("status", value);
    const query = params.toString();
    router.push(query ? `/orders?${query}` : "/orders");
  }

  return (
    <div ref={rootRef}>
      <Select id="status" name="status" defaultValue={status} onChange={applyStatus}>
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
    </div>
  );
}
