"use client";

import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Search, Trash2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PosCategory, PosMenuItem } from "@/server/services/menu-service";
import type { TaxConfig } from "@/lib/settings/tax";
import { calculateServiceCharge, calculateTax } from "@/lib/settings/tax";
import { sumRupiah } from "@/lib/money/money";
import { logoutAction } from "@/app/(auth)/login/actions";
import { submitOrderAction } from "./actions";
import { ItemModal, type ConfiguredLine } from "./item-modal";

function formatIDR(n: number) {
  return `Rp${n.toLocaleString("id-ID")}`;
}

interface CartLine extends ConfiguredLine {
  key: string;
}

const DRAFT_KEY = "cafepos.pos.draft.v1";

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`;
}

type OrderType = "dine_in" | "takeaway" | "other";
const PAYMENT_METHODS = ["cash", "card", "qris", "other"] as const;

export function PosClient({
  userName,
  categories,
  items,
  tax,
  serviceChargePercent,
}: {
  userName: string;
  categories: PosCategory[];
  items: PosMenuItem[];
  tax: TaxConfig | null;
  serviceChargePercent: number | null;
}) {
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [configuring, setConfiguring] = useState<PosMenuItem | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [tableLabel, setTableLabel] = useState("");
  const [paymentMethodLabel, setPaymentMethodLabel] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [discountTotal, setDiscountTotal] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ orderNumber: string; total: number; printStatus: string } | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  // Draft persistence (PRD §13: keep the unsaved cart in local storage).
  // This is a one-time sync from an external store on mount, not state
  // derived from props/state — the intentional exception the lint rule
  // below is guarding against false-positiving on.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(draft.cart)) setCart(draft.cart);
        if (draft.orderType) setOrderType(draft.orderType);
        if (draft.tableLabel) setTableLabel(draft.tableLabel);
        if (typeof draft.discountTotal === "number") setDiscountTotal(draft.discountTotal);
      }
    } catch {
      // ignore — start with an empty cart
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, orderType, tableLabel, discountTotal }));
    } catch {
      // storage unavailable (private mode, quota) — cart still works in-memory
    }
  }, [cart, orderType, tableLabel, discountTotal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeCategory !== "all" && item.categoryId !== activeCategory) return false;
      if (search.trim() && !item.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [items, activeCategory, search]);

  function lineTotal(line: CartLine) {
    return (line.unitBasePrice + line.modifierAdjustmentTotal) * line.quantity;
  }

  const subtotal = sumRupiah(cart.map(lineTotal));
  const netSales = Math.max(0, subtotal - discountTotal);
  const taxTotal = calculateTax(netSales, tax);
  const serviceChargeTotal = calculateServiceCharge(netSales, serviceChargePercent);
  const total = netSales + taxTotal + serviceChargeTotal;

  function addToCart(line: ConfiguredLine) {
    setCart((prev) => {
      // Merge into an identical existing line (same item/variant/modifiers/note).
      const signature = JSON.stringify([line.variantId, [...line.modifierOptionIds].sort(), line.notes ?? ""]);
      const existingIndex = prev.findIndex(
        (l) => JSON.stringify([l.variantId, [...l.modifierOptionIds].sort(), l.notes ?? ""]) === signature,
      );
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], quantity: next[existingIndex].quantity + line.quantity };
        return next;
      }
      return [...prev, { ...line, key: `${line.variantId}-${Date.now()}-${Math.random()}` }];
    });
    setConfiguring(null);
  }

  function handleItemTap(item: PosMenuItem) {
    if (item.variants.length === 1 && item.modifierGroups.length === 0) {
      addToCart({
        menuItemId: item.id,
        menuItemName: item.name,
        variantId: item.variants[0].id,
        variantName: item.variants[0].name,
        unitBasePrice: item.variants[0].price,
        modifierOptionIds: [],
        modifierNames: [],
        modifierAdjustmentTotal: 0,
        quantity: 1,
      });
      return;
    }
    setConfiguring(item);
  }

  function updateQuantity(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function resetOrder() {
    setCart([]);
    setTableLabel("");
    setDiscountTotal(0);
    setIdempotencyKey(newIdempotencyKey());
    setConfirmation(null);
    setSubmitError(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  async function handleSubmit() {
    if (cart.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);

    const result = await submitOrderAction({
      idempotencyKey,
      orderType,
      tableLabel: tableLabel || undefined,
      paymentMethodLabel,
      discountTotal,
      lines: cart.map((l) => ({
        menuItemId: l.menuItemId,
        menuItemVariantId: l.variantId,
        quantity: l.quantity,
        modifierOptionIds: l.modifierOptionIds,
        notes: l.notes,
      })),
    });

    setIsSubmitting(false);

    if (result.ok) {
      setConfirmation({ orderNumber: result.orderNumber, total: result.total, printStatus: result.printStatus });
      setCart([]);
      setTableLabel("");
      setDiscountTotal(0);
      setIdempotencyKey(newIdempotencyKey());
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
    } else {
      setSubmitError(result.error);
    }
  }

  if (confirmation) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-page-bg)] px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E7F8EF]">
          <span className="text-3xl">✓</span>
        </div>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Order submitted</h1>
        <p className="font-mono text-lg text-[var(--color-text-secondary)]">{confirmation.orderNumber}</p>
        <p className="text-3xl font-semibold tabular-nums text-[var(--color-text-primary)]">{formatIDR(confirmation.total)}</p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Print status:{" "}
          <span className={confirmation.printStatus === "FAILED" ? "font-medium text-[var(--color-danger)]" : "font-medium text-[var(--color-success)]"}>
            {confirmation.printStatus === "FAILED" ? "Failed — needs attention" : confirmation.printStatus.toLowerCase()}
          </span>
        </p>
        {confirmation.printStatus === "FAILED" ? (
          <p className="max-w-xs text-xs text-[var(--color-text-muted)]">
            The order was saved. An admin can retry printing from the order&apos;s detail page.
          </p>
        ) : null}
        <Button size="lg" onClick={resetOrder} className="mt-4">
          New order
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--color-page-bg)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">CaféOps POS</span>
          {!isOnline ? (
            <span className="flex items-center gap-1.5 rounded-full bg-[#FEF3F2] px-2.5 py-1 text-xs font-medium text-[var(--color-danger)]">
              <WifiOff size={12} />
              Offline — orders can&apos;t be submitted
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--color-text-secondary)]">{userName}</span>
          <form action={logoutAction}>
            <button type="submit" className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium hover:bg-[var(--color-selected-surface)]">
              Log out
            </button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3">
            <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2">
              <Search size={16} className="text-[var(--color-text-muted)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search menu"
                className="w-40 text-sm outline-none"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto">
              <button
                onClick={() => setActiveCategory("all")}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium ${
                  activeCategory === "all"
                    ? "border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                    : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                }`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.id)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium ${
                    activeCategory === c.id
                      ? "border-[var(--color-accent-primary)] bg-[var(--color-selected-surface)] text-[var(--color-accent-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {filteredItems.length === 0 ? (
              <p className="mt-10 text-center text-sm text-[var(--color-text-secondary)]">No menu items match.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {filteredItems.map((item) => {
                  const minPrice = Math.min(...item.variants.map((v) => v.price));
                  const maxPrice = Math.max(...item.variants.map((v) => v.price));
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleItemTap(item)}
                      className="flex flex-col items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:border-[var(--color-accent-primary)] active:bg-[var(--color-selected-surface)]"
                    >
                      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{item.name}</span>
                      <span className="tabular-nums text-sm text-[var(--color-text-secondary)]">
                        {minPrice === maxPrice ? formatIDR(minPrice) : `${formatIDR(minPrice)}–${formatIDR(maxPrice)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5 py-3.5">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Current order</h2>
            <div className="flex gap-1 rounded-[var(--radius-sm)] bg-[var(--color-page-bg)] p-0.5">
              {(["dine_in", "takeaway"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={`rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1 text-xs font-medium ${
                    orderType === t ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-muted)]"
                  }`}
                >
                  {t === "dine_in" ? "Dine-in" : "Takeaway"}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {cart.length === 0 ? (
              <p className="mt-8 text-center text-sm text-[var(--color-text-secondary)]">Cart is empty. Tap a menu item to add it.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {cart.map((line) => (
                  <li key={line.key} className="border-b border-[var(--color-border)] pb-3 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                          {line.menuItemName} <span className="text-[var(--color-text-secondary)]">· {line.variantName}</span>
                        </p>
                        {line.modifierNames.length > 0 ? (
                          <p className="truncate text-xs text-[var(--color-text-muted)]">{line.modifierNames.join(", ")}</p>
                        ) : null}
                        {line.notes ? <p className="truncate text-xs italic text-[var(--color-text-muted)]">&quot;{line.notes}&quot;</p> : null}
                      </div>
                      <span className="shrink-0 tabular-nums text-sm font-medium text-[var(--color-text-primary)]">
                        {formatIDR(lineTotal(line))}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(line.key, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)]"
                        aria-label="Decrease quantity"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="w-5 text-center text-sm tabular-nums">{line.quantity}</span>
                      <button
                        onClick={() => updateQuantity(line.key, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)]"
                        aria-label="Increase quantity"
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        onClick={() => removeLine(line.key)}
                        className="ml-auto rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                        aria-label="Remove line"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-[var(--color-border)] px-5 py-4">
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input
                value={tableLabel}
                onChange={(e) => setTableLabel(e.target.value)}
                placeholder="Table / customer"
                className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 text-sm outline-none focus:border-[var(--color-accent-primary)]"
              />
              <select
                value={paymentMethodLabel}
                onChange={(e) => setPaymentMethodLabel(e.target.value as (typeof PAYMENT_METHODS)[number])}
                className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 text-sm outline-none"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <label htmlFor="discount" className="text-sm text-[var(--color-text-secondary)]">
                Discount (Rp)
              </label>
              <input
                id="discount"
                type="number"
                min={0}
                value={discountTotal || ""}
                onChange={(e) => setDiscountTotal(Number(e.target.value) || 0)}
                className="h-8 w-28 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-right text-sm outline-none"
              />
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <Row label="Subtotal" value={formatIDR(subtotal)} />
              {discountTotal > 0 ? <Row label="Discount" value={`-${formatIDR(discountTotal)}`} /> : null}
              {taxTotal > 0 ? <Row label="Tax" value={formatIDR(taxTotal)} /> : null}
              {serviceChargeTotal > 0 ? <Row label="Service charge" value={formatIDR(serviceChargeTotal)} /> : null}
              <div className="mt-1.5 flex items-center justify-between border-t border-[var(--color-border)] pt-1.5">
                <span className="text-base font-semibold text-[var(--color-text-primary)]">Total</span>
                <span className="text-xl font-semibold tabular-nums text-[var(--color-text-primary)]">{formatIDR(total)}</span>
              </div>
            </div>

            {submitError ? (
              <p role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-[#FEF3F2] px-3 py-2 text-sm text-[var(--color-danger)]">
                {submitError}
              </p>
            ) : null}

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={cart.length === 0 || isSubmitting || !isOnline}
              onClick={handleSubmit}
            >
              {isSubmitting ? "Submitting…" : `Submit order · ${formatIDR(total)}`}
            </Button>
          </div>
        </aside>
      </div>

      {configuring ? (
        <ItemModal item={configuring} onClose={() => setConfiguring(null)} onAdd={addToCart} />
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[var(--color-text-secondary)]">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
