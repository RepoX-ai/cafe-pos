"use client";

import { useState } from "react";
import type { PrintJobPayload } from "@/printing/printer-provider";
import { formatIDR } from "@/lib/money/money";
import { formatBusinessDateTime } from "@/lib/dates/dates";
import { Button } from "@/components/ui/button";

/** Browser dialogs cannot report whether paper was actually printed. */
export function BrowserReceipt({ payload }: { payload: PrintJobPayload }) {
  const [error, setError] = useState<string | null>(null);
  function print() {
    const preview = window.open("", "_blank", "width=420,height=700");
    if (!preview) { setError("Allow pop-ups to open the receipt."); return; }
    preview.opener = null;
    const doc = preview.document;
    doc.title = payload.orderNumber;
    const style = doc.createElement("style");
    style.textContent = "body{font:14px monospace;max-width:76mm;margin:16px auto;color:#000;background:#fff}p{white-space:pre-wrap}button{padding:10px}@media print{button{display:none}body{margin:0}}";
    doc.head.append(style);
    function line(value: string) { const p = doc.createElement("p"); p.textContent = value; doc.body.append(p); }
    line(payload.locationName);
    line(payload.orderNumber);
    line(formatBusinessDateTime(new Date(payload.createdAt)));
    line([payload.orderType, payload.tableLabel].filter(Boolean).join(" · "));
    for (const item of payload.lines) {
      line(`${item.quantity} × ${item.name}${item.variantName ? ` · ${item.variantName}` : ""}`);
      if (item.modifiers.length) line(item.modifiers.join(", "));
      if (item.note) line(item.note);
      if (item.lineTotal !== undefined) line(formatIDR(item.lineTotal));
    }
    for (const [label, value] of [["Subtotal", payload.subtotal], ["Discount", payload.discount], ["Tax", payload.tax], ["Total", payload.total]] as const) {
      if (value !== undefined) line(`${label}: ${formatIDR(value)}`);
    }
    if (payload.footer) line(payload.footer);
    const button = doc.createElement("button");
    button.textContent = "Print receipt";
    button.onclick = () => preview.print();
    doc.body.append(button);
    preview.focus();
    setError(null);
  }
  return <div><Button onClick={print}>Open browser receipt</Button><p className="mt-2 text-xs">Browser printing awaits your action; paper output is not automatically confirmed.</p>{error ? <p role="alert">{error}</p> : null}</div>;
}
