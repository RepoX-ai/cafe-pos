"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, inputClassName, selectClassName } from "@/components/ui/form-field";
import { createPurchaseAction, createSupplierAction, setSupplierActiveAction } from "./actions";

type BaseUnit = "gram" | "millilitre" | "piece";

interface IngredientOption {
  id: string;
  name: string;
  baseUnit: BaseUnit;
}

interface SupplierRow {
  id: string;
  name: string;
  active: boolean;
}

interface PurchaseRow {
  id: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  status: string;
  totalCost: number;
  supplierName: string | null;
  createdAt: string | Date;
}

interface LineDraft {
  key: string;
  ingredientId: string;
  quantityPurchased: string;
  purchaseUnit: string;
  conversionToBaseUnits: string;
  unitPurchaseCost: string;
}

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `pline-${keySeq}`;
}

function formatIDR(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

type Tab = "new" | "history" | "suppliers";

export function PurchasesClient({
  ingredients,
  suppliers,
  purchases,
}: {
  ingredients: IngredientOption[];
  suppliers: SupplierRow[];
  purchases: PurchaseRow[];
}) {
  const [tab, setTab] = useState<Tab>("new");

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-[var(--color-border)]">
        {(
          [
            ["new", "New receipt"],
            ["history", "History"],
            ["suppliers", "Suppliers"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === value
                ? "border-[var(--color-accent-primary)] text-[var(--color-text-primary)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "new" ? <NewReceiptTab ingredients={ingredients} suppliers={suppliers} /> : null}
      {tab === "history" ? <HistoryTab purchases={purchases} /> : null}
      {tab === "suppliers" ? <SuppliersTab suppliers={suppliers} /> : null}
    </div>
  );
}

function NewReceiptTab({ ingredients, suppliers }: { ingredients: IngredientOption[]; suppliers: SupplierRow[] }) {
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineDraft[]>([
    { key: newKey(), ingredientId: "", quantityPurchased: "", purchaseUnit: "", conversionToBaseUnits: "", unitPurchaseCost: "" },
  ]);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: newKey(), ingredientId: "", quantityPurchased: "", purchaseUnit: "", conversionToBaseUnits: "", unitPurchaseCost: "" },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const estimatedTotal = lines.reduce((sum, l) => {
    const qty = Number(l.quantityPurchased) || 0;
    const cost = Number(l.unitPurchaseCost) || 0;
    return sum + Math.round(qty * cost);
  }, 0);

  async function submit() {
    setResult(null);
    setIsPending(true);
    const res = await createPurchaseAction({
      supplierId: supplierId || undefined,
      invoiceNumber: invoiceNumber || undefined,
      purchaseDate,
      lines: lines
        .filter((l) => l.ingredientId)
        .map((l) => ({
          ingredientId: l.ingredientId,
          quantityPurchased: Number(l.quantityPurchased),
          purchaseUnit: l.purchaseUnit,
          conversionToBaseUnits: Number(l.conversionToBaseUnits),
          unitPurchaseCost: Number(l.unitPurchaseCost),
        })),
    });
    setIsPending(false);
    if (res.ok) {
      setResult({ ok: true, text: "Purchase receipt finalized — stock and average cost updated." });
      setLines([{ key: newKey(), ingredientId: "", quantityPurchased: "", purchaseUnit: "", conversionToBaseUnits: "", unitPurchaseCost: "" }]);
      setInvoiceNumber("");
    } else {
      setResult({ ok: false, text: res.error });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Supplier" htmlFor="supplierId">
          <select id="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={selectClassName}>
            <option value="">No supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Invoice / reference #" htmlFor="invoiceNumber">
          <input id="invoiceNumber" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inputClassName} />
        </Field>
        <Field label="Purchase date" htmlFor="purchaseDate">
          <input id="purchaseDate" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputClassName} />
        </Field>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-3 py-2.5">Ingredient</th>
              <th className="px-3 py-2.5">Qty purchased</th>
              <th className="px-3 py-2.5">Unit (e.g. kg)</th>
              <th className="px-3 py-2.5">→ base units</th>
              <th className="px-3 py-2.5">Cost / purchased unit (Rp)</th>
              <th className="px-3 py-2.5 text-right">Line total</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const qty = Number(line.quantityPurchased) || 0;
              const cost = Number(line.unitPurchaseCost) || 0;
              return (
                <tr key={line.key} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-3 py-2">
                    <select
                      value={line.ingredientId}
                      onChange={(e) => updateLine(line.key, { ingredientId: e.target.value })}
                      className={selectClassName + " w-full"}
                    >
                      <option value="">Select…</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={line.quantityPurchased}
                      onChange={(e) => updateLine(line.key, { quantityPurchased: e.target.value })}
                      className={inputClassName + " w-24"}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.purchaseUnit}
                      placeholder="kg"
                      onChange={(e) => updateLine(line.key, { purchaseUnit: e.target.value })}
                      className={inputClassName + " w-24"}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="1000"
                      value={line.conversionToBaseUnits}
                      onChange={(e) => updateLine(line.key, { conversionToBaseUnits: e.target.value })}
                      className={inputClassName + " w-24"}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={line.unitPurchaseCost}
                      onChange={(e) => updateLine(line.key, { unitPurchaseCost: e.target.value })}
                      className={inputClassName + " w-28"}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">
                    {formatIDR(Math.round(qty * cost))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => removeLine(line.key)} className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-[var(--color-border)] px-3 py-2.5">
          <button onClick={addLine} className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-accent-primary)] hover:underline">
            <Plus size={14} />
            Add line
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">Estimated total</span>
        <span className="text-lg font-semibold tabular-nums text-[var(--color-text-primary)]">{formatIDR(estimatedTotal)}</span>
      </div>

      {result ? (
        <p
          role="status"
          className={`rounded-[var(--radius-sm)] px-3 py-2 text-sm ${
            result.ok ? "bg-[#E7F8EF] text-[var(--color-success)]" : "bg-[#FEF3F2] text-[var(--color-danger)]"
          }`}
        >
          {result.text}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={isPending || lines.every((l) => !l.ingredientId)}>
          {isPending ? "Finalizing…" : "Finalize receipt"}
        </Button>
      </div>
    </div>
  );
}

function HistoryTab({ purchases }: { purchases: PurchaseRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Supplier</th>
            <th className="px-4 py-3">Invoice</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {purchases.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                No purchases recorded yet.
              </td>
            </tr>
          ) : (
            purchases.map((p) => (
              <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{p.purchaseDate}</td>
                <td className="px-4 py-3 text-[var(--color-text-primary)]">{p.supplierName ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">{p.invoiceNumber ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={p.status === "FINALIZED" ? "success" : "neutral"}>{p.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatIDR(p.totalCost)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SuppliersTab({ suppliers }: { suppliers: SupplierRow[] }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setIsPending(true);
    await createSupplierAction({ name, phone });
    setIsPending(false);
    setName("");
    setPhone("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <Field label="Supplier name" htmlFor="supplierName">
          <input id="supplierName" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
        </Field>
        <Field label="Phone" htmlFor="supplierPhone">
          <input id="supplierPhone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClassName} />
        </Field>
        <Button onClick={add} disabled={isPending || !name.trim()}>
          Add supplier
        </Button>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-[var(--color-text-secondary)]">
                  No suppliers yet.
                </td>
              </tr>
            ) : (
              suppliers.map((s) => (
                <tr key={s.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{s.name}</td>
                  <td className="px-4 py-3">
                    <Badge tone={s.active ? "success" : "neutral"}>{s.active ? "Active" : "Archived"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSupplierActiveAction(s.id, !s.active)}
                      className="text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      {s.active ? "Archive" : "Restore"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
