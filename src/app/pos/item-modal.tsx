"use client";

import { formatIDR } from "@/lib/money/money";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { ImageOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import type { PosMenuItem } from "@/server/services/menu-service";

export interface ConfiguredLine {
  menuItemId: string;
  menuItemName: string;
  // Null when the item has no variants — sold directly off its basePrice.
  variantId: string | null;
  variantName: string | null;
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
  const [variantId, setVariantId] = useState(
    item.variants.find((v) => v.inStock)?.id ?? item.variants[0]?.id ?? "",
  );
  const [selectedOptions, setSelectedOptions] = useState<Record<string, Set<string>>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [imageFailed, setImageFailed] = useState(false);

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
  const unitPrice = (variant?.price ?? item.basePrice) + modifierAdjustmentTotal;
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
    (g) => (selectedOptions[g.id]?.size ?? 0) < Math.max(g.required ? 1 : 0, g.minSelections),
  );

  function handleAdd() {
    // A variant is only required when the item actually has one to pick.
    if ((item.variants.length > 0 && !variant) || (variant && !variant.inStock) || missingRequired.length > 0) return;
    onAdd({
      menuItemId: item.id,
      menuItemName: item.name,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      unitBasePrice: variant?.price ?? item.basePrice,
      modifierOptionIds: flatSelected.map((o) => o.id),
      modifierNames: flatSelected.map((o) => o.name),
      modifierAdjustmentTotal,
      quantity,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Dialog open label={item.name} onClose={onClose} className="max-w-[520px]">
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[520px] min-w-0 flex-col rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-lg sm:rounded-[var(--radius-lg)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {item.imageUrl && !imageFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded-[var(--radius-sm)] object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-page-bg)]">
                <ImageOff size={16} className="text-[var(--color-text-muted)]" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{item.name}</h2>
              {item.description ? <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{item.description}</p> : null}
            </div>
          </div>
          <button aria-label="Close item" onClick={onClose} className="shrink-0 rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-page-bg)]">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {item.variants.length > 1 ? (
            <div className="mb-5">
              <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">Size</p>
              <div className="flex flex-wrap gap-2">
                {item.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => v.inStock && setVariantId(v.id)}
                    disabled={!v.inStock}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      !v.inStock
                        ? "cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-muted)] opacity-50"
                        : v.id === variantId
                          ? "border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                          : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {v.name} · {formatIDR(v.price)}
                    {!v.inStock ? " · Out of stock" : ""}
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
                      onClick={() => opt.inStock && toggleOption(group.id, opt.id, group.maxSelections)}
                      disabled={!opt.inStock}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                        !opt.inStock
                          ? "cursor-not-allowed border-[var(--color-border)] text-[var(--color-text-muted)] opacity-50"
                          : checked
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
                      {!opt.inStock ? " · Out of stock" : ""}
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3 sm:flex-nowrap sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <QuantityStepper
              value={quantity}
              onDecrease={() => setQuantity((q) => Math.max(1, q - 1))}
              onIncrease={() => setQuantity((q) => q + 1)}
            />
          </div>
          <Button
            size="lg"
            className="min-w-0 flex-1"
            disabled={missingRequired.length > 0 || (item.variants.length > 0 && !variant?.inStock)}
            onClick={handleAdd}
          >
            Add · {formatIDR(total)}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
