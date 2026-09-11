"use client";

import { useMemo, useState } from "react";
import { X, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PosMenuItem } from "@/server/services/menu-service";

function formatIDR(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

export interface ConfiguredLine {
  menuItemId: string;
  menuItemName: string;
  variantId: string;
  variantName: string;
  unitBasePrice: number;
  modifierOptionIds: string[];
  modifierNames: string[];
  modifierAdjustmentTotal: number;
  quantity: number;
  notes?: string;
}

export function ItemModal({
  item,
  onClose,
  onAdd,
}: {
  item: PosMenuItem;
  onClose: () => void;
  onAdd: (line: ConfiguredLine) => void;
}) {
  const [variantId, setVariantId] = useState(item.variants[0]?.id ?? "");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Set<string>>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const variant = item.variants.find((v) => v.id === variantId) ?? item.variants[0];

  const flatSelected = useMemo(
    () =>
      Object.values(selectedOptions).flatMap((set) =>
        Array.from(set).map((id) => {
          for (const group of item.modifierGroups) {
            const opt = group.options.find((o) => o.id === id);
            if (opt) return opt;
          }
          return null;
        }),
      ).filter((o): o is NonNullable<typeof o> => o !== null),
    [selectedOptions, item.modifierGroups],
  );

  const modifierAdjustmentTotal = flatSelected.reduce((sum, o) => sum + o.priceAdjustment, 0);
  const unitPrice = (variant?.price ?? 0) + modifierAdjustmentTotal;
  const total = unitPrice * quantity;

  function toggleOption(groupId: string, optionId: string, max: number) {
    setSelectedOptions((prev) => {
      const next = { ...prev };
      const current = new Set(next[groupId] ?? []);
      if (current.has(optionId)) {
        current.delete(optionId);
      } else {
        if (max === 1) current.clear();
        else if (current.size >= max) return prev; // at cap, ignore
        current.add(optionId);
      }
      next[groupId] = current;
      return next;
    });
  }

  const missingRequired = item.modifierGroups.filter(
    (g) => g.required && (selectedOptions[g.id]?.size ?? 0) < Math.max(1, g.minSelections),
  );

  function handleAdd() {
    if (!variant || missingRequired.length > 0) return;
    onAdd({
      menuItemId: item.id,
      menuItemName: item.name,
      variantId: variant.id,
      variantName: variant.name,
      unitBasePrice: variant.price,
      modifierOptionIds: flatSelected.map((o) => o.id),
      modifierNames: flatSelected.map((o) => o.name),
      modifierAdjustmentTotal,
      quantity,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/30" />
      <div className="relative flex max-h-[90vh] w-full max-w-[520px] flex-col rounded-t-[var(--radius-lg)] bg-[var(--color-surface)] shadow-lg sm:rounded-[var(--radius-lg)]">
        <div className="flex items-start justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{item.name}</h2>
            {item.description ? <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{item.description}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {item.variants.length > 1 ? (
            <div className="mb-5">
              <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">Size</p>
              <div className="flex flex-wrap gap-2">
                {item.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVariantId(v.id)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      v.id === variantId
                        ? "border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {v.name} · {formatIDR(v.price)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {item.modifierGroups.map((group) => (
            <div key={group.id} className="mb-5">
              <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                {group.name}
                {group.required ? <span className="ml-1 text-[var(--color-danger)]">*</span> : null}
                <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                  {group.maxSelections > 1 ? `choose up to ${group.maxSelections}` : "choose one"}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {group.options.map((opt) => {
                  const checked = selectedOptions[group.id]?.has(opt.id) ?? false;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleOption(group.id, opt.id, group.maxSelections)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                        checked
                          ? "border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                          : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {opt.name}
                      {opt.priceAdjustment !== 0 ? (
                        <span className="ml-1 tabular-nums text-xs">
                          ({opt.priceAdjustment > 0 ? "+" : ""}
                          {formatIDR(opt.priceAdjustment)})
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mb-2">
            <label htmlFor="item-note" className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">
              Note (optional)
            </label>
            <input
              id="item-note"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. less ice"
              className="h-11 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm outline-none focus:border-[var(--color-accent-primary)]"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-primary)]"
              aria-label="Decrease quantity"
            >
              <Minus size={16} />
            </button>
            <span className="w-6 text-center text-base font-semibold tabular-nums text-[var(--color-text-primary)]">{quantity}</span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-primary)]"
              aria-label="Increase quantity"
            >
              <Plus size={16} />
            </button>
          </div>
          <Button size="lg" className="flex-1" disabled={missingRequired.length > 0} onClick={handleAdd}>
            Add · {formatIDR(total)}
          </Button>
        </div>
      </div>
    </div>
  );
}
