"use client";

import { formatIDR } from "@/lib/money/money";
import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { usePagination } from "@/components/ui/use-pagination";
import { createPurchaseAction, createSupplierAction, updateSupplierAction, setSupplierActiveAction } from "./actions";
import { useToast } from "@/components/ui/toast";
import { unstable_rethrow } from "next/navigation";

type BaseUnit = "gram" | "millilitre" | "piece";

const UNIT_LABEL: Record<BaseUnit, string> = { gram: "g", millilitre: "ml", piece: "pc" };

interface IngredientOption {
  id: string;
  name: string;
  baseUnit: BaseUnit;
}

interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
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

      {tab === "new" ? (
        <NewReceiptTab ingredients={ingredients} suppliers={suppliers.filter((s) => s.active)} />
      ) : null}
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

function HistoryTab({ purchases }: { purchases: PurchaseRow[] }) {
  const { page, setPage, totalPages, pageItems, pageSize, totalItems } = usePagination(purchases, 20);

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="overflow-x-auto">
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
          {pageItems.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-text-secondary)]">
                No purchases recorded yet.
              </td>
            </tr>
          ) : (
            pageItems.map((p) => (
              <tr key={p.id} className="relative border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-page-bg)]">
                <td className="relative px-4 py-3 text-[var(--color-text-secondary)]">
                  <Link href={`/purchases/${p.id}`} className="absolute inset-0" aria-label={`View purchase ${p.invoiceNumber ?? p.purchaseDate}`} />
                  {p.purchaseDate}
                </td>
                <td className="px-4 py-3 text-[var(--color-text-primary)]">{p.supplierName ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{p.invoiceNumber ?? "—"}</td>
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
      <Pagination page={page} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />
    </div>
  );
}

function SuppliersTab({ suppliers }: { suppliers: SupplierRow[] }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const showToast = useToast();

  async function add() {
    if (!name.trim()) return;
    setIsPending(true);
    const result = await createSupplierAction({ name, phone });
    setIsPending(false);
    if (result.ok) {
      showToast("success", "Supplier added.");
      setName("");
      setPhone("");
    } else {
      showToast("error", result.error);
    }
  }

  async function toggleActive(supplier: SupplierRow) {
    try {
      await setSupplierActiveAction(supplier.id, !supplier.active);
      showToast("success", supplier.active ? "Supplier archived." : "Supplier restored.");
    } catch (error) {
      unstable_rethrow(error);
      showToast("error", error instanceof Error ? error.message : "Couldn't update supplier.");
    }
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
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--color-text-secondary)]">
                  No suppliers yet.
                </td>
              </tr>
            ) : (
              suppliers.map((s) => (
                <tr key={s.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{s.name}</td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{s.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={s.active ? "success" : "neutral"}>{s.active ? "Active" : "Archived"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <ActionMenu
                        label={`Actions for ${s.name}`}
                        items={[
                          { label: "Edit details", onSelect: () => setEditing(s) },
                          {
                            label: s.active ? "Archive" : "Restore",
                            onSelect: () => toggleActive(s),
                            tone: s.active ? "danger" : "default",
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit supplier">
        {editing ? <EditSupplierForm supplier={editing} onDone={() => setEditing(null)} /> : null}
      </Modal>
    </div>
  );
}

function EditSupplierForm({ supplier, onDone }: { supplier: SupplierRow; onDone: () => void }) {
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const showToast = useToast();

  async function save() {
    if (!name.trim()) return;
    setIsPending(true);
    setError(null);
    const result = await updateSupplierAction(supplier.id, { name, phone });
    setIsPending(false);
    if (result.ok) {
      showToast("success", "Supplier saved.");
      onDone();
    } else {
      setError(result.error);
      showToast("error", result.error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Supplier name" htmlFor="editSupplierName">
        <input id="editSupplierName" value={name} onChange={(e) => setName(e.target.value)} className={inputClassName} />
      </Field>
      <Field label="Phone" htmlFor="editSupplierPhone">
        <input id="editSupplierPhone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClassName} />
      </Field>
      {error ? (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} disabled={isPending || !name.trim()}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
