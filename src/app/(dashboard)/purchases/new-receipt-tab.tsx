"use client";

import { formatIDR } from "@/lib/money/money";
import { purchaseUnitOptionsFor } from "@/lib/units/units";
import { useState } from "react";
import { Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form-field";
import { Tooltip } from "@/components/ui/tooltip";
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

/** Sentinel for the dropdown's escape hatch; never sent to the server. */
const CUSTOM_PACK = "__custom__";

function emptyLine(): LineDraft {
  return {
    key: newKey(),
    ingredientId: "",
    quantityPurchased: "",
    purchaseUnit: "",
    conversionToBaseUnits: "",
    customPack: false,
    unitPurchaseCost: "",
  };
}

function isLineReady(line: LineDraft) {
  return (
    !!line.ingredientId &&
    Number(line.quantityPurchased) > 0 &&
    line.purchaseUnit.trim() !== "" &&
    Number(line.conversionToBaseUnits) > 0 &&
    line.unitPurchaseCost.trim() !== ""
  );
}

function formatQty(value: number) {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 4 });
}

// The cost field carries its unit inside the box, leaving no room for the
// browser's spin buttons — and these are typed amounts, not nudged ones.
const costInputClassName =
  inputClassName +
  " w-full pr-16 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export function NewReceiptTab({ ingredients, suppliers }: { ingredients: IngredientOption[]; suppliers: SupplierRow[] }) {
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const showToast = useToast();

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // Changing the ingredient can change the base unit, which invalidates any
  // unit already picked, so the line resets to that base unit's default.
  function selectIngredient(key: string, ingredientId: string) {
    const ingredient = ingredients.find((i) => i.id === ingredientId);
    const preset = ingredient ? purchaseUnitOptionsFor(ingredient.baseUnit)[0] : undefined;
    updateLine(key, {
      ingredientId,
      customPack: false,
      purchaseUnit: preset?.unit ?? "",
      conversionToBaseUnits: preset ? String(preset.conversionToBaseUnits) : "",
    });
  }

  function selectUnit(key: string, ingredient: IngredientOption, value: string) {
    if (value === CUSTOM_PACK) {
      updateLine(key, { customPack: true, purchaseUnit: "", conversionToBaseUnits: "" });
      return;
    }
    const preset = purchaseUnitOptionsFor(ingredient.baseUnit).find((o) => o.unit === value);
    if (!preset) return;
    updateLine(key, {
      customPack: false,
      purchaseUnit: preset.unit,
      conversionToBaseUnits: String(preset.conversionToBaseUnits),
    });
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const estimatedTotal = lines.reduce((sum, l) => {
    const qty = Number(l.quantityPurchased) || 0;
    const cost = Number(l.unitPurchaseCost) || 0;
    return sum + Math.round(qty * cost);
  }, 0);

  const filledLines = lines.filter((l) => l.ingredientId);
  const canSubmit = filledLines.length > 0 && filledLines.every(isLineReady);

  async function submit() {
    setResult(null);
    setIsPending(true);
    const res = await createPurchaseAction({
      supplierId: supplierId || undefined,
      invoiceNumber: invoiceNumber || undefined,
      purchaseDate,
      lines: filledLines.map((l) => ({
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
      setLines([emptyLine()]);
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
            <col className="w-[260px]" />
            <col className="w-24" />
            <col className="w-[220px]" />
            <col className="w-40" />
            <col className="w-32" />
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              <th className="px-3 py-2.5">Ingredient</th>
              <th className="px-3 py-2.5">Qty</th>
              <th className="px-3 py-2.5">Unit</th>
              <th className="px-3 py-2.5">Cost per unit (Rp)</th>
              <th className="px-3 py-2.5">Line total</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const qty = Number(line.quantityPurchased) || 0;
              const cost = Number(line.unitPurchaseCost) || 0;
              const conversion = Number(line.conversionToBaseUnits) || 0;
              const ingredient = ingredients.find((i) => i.id === line.ingredientId);
              const baseUnitLabel = ingredient ? UNIT_LABEL[ingredient.baseUnit] : "base unit";
              const unitOptions = ingredient ? purchaseUnitOptionsFor(ingredient.baseUnit) : [];
              return (
                <tr key={line.key} className="border-b border-[var(--color-border)] align-top last:border-0">
                  <td className="px-3 py-2">
                    <Select value={line.ingredientId} onChange={(value) => selectIngredient(line.key, value)}>
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
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Select
                          className="min-w-0 flex-1"
                          value={line.customPack ? CUSTOM_PACK : line.purchaseUnit}
                          disabled={!ingredient}
                          onChange={(value) => ingredient && selectUnit(line.key, ingredient, value)}
                        >
                          {ingredient ? null : <option value="">Pick an ingredient first</option>}
                          {unitOptions.map((o) => (
                            <option key={o.unit} value={o.unit}>
                              {o.label}
                            </option>
                          ))}
                          {ingredient ? <option value={CUSTOM_PACK}>Custom pack…</option> : null}
                        </Select>
                        {/* Fixed-width slot so the select keeps its width whether or not the hint applies. */}
                        <span className="flex w-4 shrink-0 justify-center">
                          {qty > 0 && conversion > 0 ? (
                            <Tooltip label={`Adds ${formatQty(qty * conversion)} ${baseUnitLabel} to stock`}>
                              <Info size={14} role="img" aria-label="Stock effect" className="text-[var(--color-text-muted)]" />
                            </Tooltip>
                          ) : null}
                        </span>
                      </div>
                      {line.customPack ? (
                        <div className="flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--color-text-secondary)]">
                          <span>1</span>
                          <input
                            value={line.purchaseUnit}
                            placeholder="box"
                            onChange={(e) => updateLine(line.key, { purchaseUnit: e.target.value })}
                            className={inputClassName + " w-16 min-w-0"}
                            aria-label="Pack name"
                          />
                          <span>=</span>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="24"
                            value={line.conversionToBaseUnits}
                            onChange={(e) => updateLine(line.key, { conversionToBaseUnits: e.target.value })}
                            className={inputClassName + " w-16 min-w-0"}
                            aria-label={`Equivalent in ${baseUnitLabel}`}
                          />
                          <span>{baseUnitLabel}</span>
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={line.unitPurchaseCost}
                        onChange={(e) => updateLine(line.key, { unitPurchaseCost: e.target.value })}
                        className={costInputClassName}
                      />
                      {line.purchaseUnit ? (
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex max-w-[52px] items-center truncate text-xs text-[var(--color-text-muted)]">
                          per {line.purchaseUnit}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[var(--color-text-secondary)]">
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
        <Button onClick={submit} disabled={isPending || !canSubmit}>
          {isPending ? "Finalizing…" : "Finalize receipt"}
        </Button>
      </div>
    </div>
  );
}
