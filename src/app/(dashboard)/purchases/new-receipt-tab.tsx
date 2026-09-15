"use client";

import { formatIDR } from "@/lib/money/money";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/components/ui/toast";
import { createPurchaseAction } from "./actions";
import { UNIT_LABEL, type IngredientOption, type LineDraft, type SupplierRow } from "./purchase-types";

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `pline-${keySeq}`;
}

export function NewReceiptTab({ ingredients, suppliers }: { ingredients: IngredientOption[]; suppliers: SupplierRow[] }) {
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineDraft[]>([
    { key: newKey(), ingredientId: "", quantityPurchased: "", purchaseUnit: "", conversionToBaseUnits: "", unitPurchaseCost: "" },
  ]);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const showToast = useToast();

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
      showToast("success", "Purchase receipt finalized — stock and average cost updated.");
      setResult(null);
      setLines([{ key: newKey(), ingredientId: "", quantityPurchased: "", purchaseUnit: "", conversionToBaseUnits: "", unitPurchaseCost: "" }]);
      setInvoiceNumber("");
    } else {
      setResult({ ok: false, text: res.error });
      showToast("error", res.error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Supplier" htmlFor="supplierId">
          <Select id="supplierId" value={supplierId} onChange={setSupplierId}>
            <option value="">No supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice / reference #" htmlFor="invoiceNumber">
          <input id="invoiceNumber" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inputClassName} />
        </Field>
        <Field label="Purchase date" htmlFor="purchaseDate">
          <DatePicker id="purchaseDate" value={purchaseDate} onChange={setPurchaseDate} />
        </Field>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[960px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[280px]" />
            <col className="w-24" />
            <col className="w-[260px]" />
            <col className="w-36" />
            <col className="w-32" />
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-3 py-2.5">Ingredient</th>
              <th className="px-3 py-2.5">Qty purchased</th>
              <th className="px-3 py-2.5">How you buy it</th>
              <th className="px-3 py-2.5">Cost / purchased unit (Rp)</th>
              <th className="px-3 py-2.5 text-right">Line total</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const qty = Number(line.quantityPurchased) || 0;
              const cost = Number(line.unitPurchaseCost) || 0;
              const ingredient = ingredients.find((i) => i.id === line.ingredientId);
              const baseUnitLabel = ingredient ? UNIT_LABEL[ingredient.baseUnit] : "base unit";
              return (
                <tr key={line.key} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-3 py-2">
                    <Select value={line.ingredientId} onChange={(value) => updateLine(line.key, { ingredientId: value })}>
                      <option value="">Select…</option>
                      {ingredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={line.quantityPurchased}
                      onChange={(e) => updateLine(line.key, { quantityPurchased: e.target.value })}
                      className={inputClassName + " w-full"}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--color-text-secondary)]">
                      <span>1</span>
                      <input
                        value={line.purchaseUnit}
                        placeholder="kg"
                        onChange={(e) => updateLine(line.key, { purchaseUnit: e.target.value })}
                        className={inputClassName + " w-16"}
                        aria-label="Purchase unit"
                      />
                      <span>=</span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        placeholder="1000"
                        value={line.conversionToBaseUnits}
                        onChange={(e) => updateLine(line.key, { conversionToBaseUnits: e.target.value })}
                        className={inputClassName + " w-20"}
                        aria-label={`Equivalent in ${baseUnitLabel}`}
                      />
                      <span>{baseUnitLabel}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={line.unitPurchaseCost}
                      onChange={(e) => updateLine(line.key, { unitPurchaseCost: e.target.value })}
                      className={inputClassName + " w-full"}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-secondary)]">
                    {formatIDR(Math.round(qty * cost))}
                  </td>
                  <td className="px-1.5 py-2 text-right">
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
            result.ok ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" : "bg-[var(--color-danger-bg)] text-[var(--color-danger)]"
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
