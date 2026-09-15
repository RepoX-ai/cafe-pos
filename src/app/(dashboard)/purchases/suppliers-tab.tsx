"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/form-field";
import { inputClassName } from "@/components/ui/form-styles";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { createSupplierAction, setSupplierActiveAction, updateSupplierAction } from "./actions";
import type { SupplierRow } from "./purchase-types";

export function SuppliersTab({ suppliers }: { suppliers: SupplierRow[] }) {
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
