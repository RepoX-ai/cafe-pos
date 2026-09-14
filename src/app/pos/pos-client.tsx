"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cartDraftSchema, cartLineSignature } from "@/lib/pos/cart";
import { submitOrderInputSchema, type SubmitOrderInput } from "@/lib/validation/order";
import { BrowserReceipt } from "@/components/browser-receipt";
import type { PrintJobPayload } from "@/printing/printer-provider";
import Link from "next/link";
import { History, ImageOff, Search, Trash2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { Select } from "@/components/ui/form-field";
import type { PosCategory, PosMenuItem } from "@/server/services/menu-service";
import type { TaxConfig } from "@/lib/settings/tax";
import { calculateServiceCharge, calculateTax } from "@/lib/settings/tax";
import { formatIDR, sumRupiah } from "@/lib/money/money";
import { logoutAction } from "@/app/(auth)/login/actions";
import { BrandLogo } from "@/components/brand-logo";
import { submitOrderAction } from "./actions";
import { ItemModal, type ConfiguredLine } from "./item-modal";
import { useToast } from "@/components/ui/toast";

interface CartLine extends ConfiguredLine {
  key: string;
}

const DRAFT_KEY = "cafepos.pos.draft.v1";

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`;
}

type OrderType = "dine_in" | "takeaway" | "other";
const PAYMENT_METHODS = ["cash", "card", "qris", "other"] as const;
const CARD_BANKS = ["bca", "mandiri", "bri"] as const;
const CARD_BANK_LABELS: Record<(typeof CARD_BANKS)[number], string> = {
  bca: "BCA",
  mandiri: "Mandiri",
  bri: "BRI",
};

export function PosClient({
  draftScope,
  userName,
  categories,
  items,
  tax,
  serviceChargePercent,
  canViewOrderHistory,
}: {
  draftScope: string;
  userName: string;
  categories: PosCategory[];
  items: PosMenuItem[];
  tax: TaxConfig | null;
  serviceChargePercent: number | null;
  canViewOrderHistory: boolean;
}) {
  const draftKey = `${DRAFT_KEY}:${draftScope}`;
  const pendingKey = `${draftKey}:pending`;
  const submitting = useRef(false);
  const showToast = useToast();
  const [pending, setPending] = useState<SubmitOrderInput | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [configuring, setConfiguring] = useState<PosMenuItem | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [tableLabel, setTableLabel] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [cardBank, setCardBank] = useState<(typeof CARD_BANKS)[number] | null>(null);
  const paymentMethodLabel =
    paymentMethod === "card" && cardBank ? `card (${CARD_BANK_LABELS[cardBank]})` : paymentMethod;
  const [discountTotal, setDiscountTotal] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ orderNumber: string; total: number; printStatus: string; receipt?: PrintJobPayload } | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  // Draft persistence (PRD §13: keep the unsaved cart in local storage).
  // This is a one-time sync from an external store on mount, not state
  // derived from props/state — the intentional exception the lint rule
  // below is guarding against false-positiving on.
  useEffect(() => {
    try {
      const savedPending = localStorage.getItem(pendingKey);
      if (savedPending) {
        const parsed = submitOrderInputSchema.safeParse(JSON.parse(savedPending));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the persisted external store once
        if (parsed.success) setPending(parsed.data);
      }
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsedDraft = cartDraftSchema.safeParse(JSON.parse(raw));
        if (!parsedDraft.success) throw new Error("Invalid saved draft");
        const draft = parsedDraft.data;
        if (Array.isArray(draft.cart)) setCart(draft.cart);
        if (typeof draft.idempotencyKey === "string") setIdempotencyKey(draft.idempotencyKey);
        if (PAYMENT_METHODS.includes(draft.paymentMethod)) setPaymentMethod(draft.paymentMethod);
        setCardBank(draft.cardBank);
        if (draft.orderType) setOrderType(draft.orderType);
        if (draft.tableLabel) setTableLabel(draft.tableLabel);
        if (typeof draft.discountTotal === "number") setDiscountTotal(draft.discountTotal);
      }
    } catch {
      // ignore — start with an empty cart
    }
    setDraftLoaded(true);
  }, [draftKey, pendingKey]);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ cart, orderType, tableLabel, discountTotal, idempotencyKey, paymentMethod, cardBank }));
    } catch {
      // storage unavailable (private mode, quota) — cart still works in-memory
    }
  }, [cart, orderType, tableLabel, discountTotal, idempotencyKey, paymentMethod, cardBank, draftLoaded, draftKey]);

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
      const signature = cartLineSignature(line);
      const existingIndex = prev.findIndex(
        (l) => cartLineSignature(l) === signature,
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
    if (item.outOfStock) return;
    const variant = item.variants[0];
    if (variant && !variant.inStock && item.variants.length <= 1) return;

    // Zero variants (sold off basePrice) or exactly one variant can skip
    // the picker and go straight to the cart; more than one variant, or
    // any modifier groups, need the configure modal.
    if (item.variants.length <= 1 && item.modifierGroups.length === 0) {
      addToCart({
        menuItemId: item.id,
        menuItemName: item.name,
        variantId: variant?.id ?? null,
        variantName: variant?.name ?? null,
        unitBasePrice: variant?.price ?? item.basePrice,
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
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
  }

  async function handleSubmit() {
    if ((!pending && cart.length === 0) || submitting.current || !draftLoaded || !isOnline) return;
    if (!pending && paymentMethod === "card" && !cardBank) return;
    setIsSubmitting(true);
    setSubmitError(null);

    const request = pending ?? {
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
    };

    submitting.current = true;
    try {
      // Persist the exact request before sending. A lost response must retry this key and payload.
      localStorage.setItem(pendingKey, JSON.stringify(request));
      setPending(request);
      const result = await submitOrderAction(request);
      localStorage.removeItem(pendingKey);
      setPending(null);
      if (result.ok) {
        setConfirmation({ orderNumber: result.orderNumber, total: result.total, printStatus: result.printStatus, receipt: result.receipt });
        setCart([]);
        setTableLabel("");
        setDiscountTotal(0);
        setIdempotencyKey(newIdempotencyKey());
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
      } else {
        setSubmitError(result.error);
        showToast("error", result.error);
      }
    } catch {
      const text = "Could not confirm the order. Retry the saved submission before starting another order. Browser storage must be available.";
      setSubmitError(text);
      showToast("error", text);
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div className="force-light-theme flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-page-bg)] px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-success-bg)]">
          <span className="text-3xl">✓</span>
        </div>
        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Order submitted</h1>
        <p className="text-lg text-[var(--color-text-secondary)]">{confirmation.orderNumber}</p>
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
        {confirmation.receipt ? <BrowserReceipt payload={confirmation.receipt} /> : null}
        <Button size="lg" onClick={resetOrder} className="mt-4">
          New order
        </Button>
      </div>
    );
  }

  return (
    <div className="force-light-theme flex h-screen flex-col bg-[var(--color-page-bg)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
        <div className="flex items-center gap-3">
          <BrandLogo className="h-9" />
          {!isOnline ? (
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-danger-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-danger)]">
              <WifiOff size={12} />
              Offline — orders can&apos;t be submitted
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {canViewOrderHistory ? (
            <Link
              href="/pos/orders"
              className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium hover:bg-[var(--color-selected-surface)]"
            >
              <History size={12} />
              Order history
            </Link>
          ) : null}
          <span className="text-sm text-[var(--color-text-secondary)]">{userName}</span>
          <form action={logoutAction}>
            <button type="submit" className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium hover:bg-[var(--color-selected-surface)]">
              Log out
            </button>
          </form>
        </div>
      </header>

      {pending ? <div role="alert" className="p-4">A submission needs confirmation. <Button disabled={isSubmitting || !isOnline} onClick={handleSubmit}>Retry saved order</Button>{submitError ? <p>{submitError}</p> : null}</div> : null}
      <div inert={!!pending || isSubmitting || !draftLoaded} className="flex min-h-0 flex-1">
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
                  const prices = item.variants.length > 0 ? item.variants.map((v) => v.price) : [item.basePrice];
                  const minPrice = Math.min(...prices);
                  const maxPrice = Math.max(...prices);
                  const singleVariantOutOfStock =
                    item.variants.length === 1 && !item.variants[0].inStock;
                  const unavailable = item.outOfStock || singleVariantOutOfStock;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleItemTap(item)}
                      disabled={unavailable}
                      aria-disabled={unavailable}
                      className={`relative flex flex-col items-start gap-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-left transition-colors ${
                        unavailable
                          ? "cursor-not-allowed opacity-50"
                          : "hover:border-[var(--color-accent-primary)] active:bg-[var(--color-selected-surface)]"
                      }`}
                    >
                      <ItemThumbnail item={item} />
                      {unavailable ? (
                        <span className="absolute right-2 top-2 rounded-full bg-[var(--color-danger)] px-2 py-0.5 text-xs font-medium text-white">
                          Out of stock
                        </span>
                      ) : null}
                      <div className="flex flex-col gap-0.5 px-4 pb-4">
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{item.name}</span>
                        <span className="tabular-nums text-sm text-[var(--color-text-secondary)]">
                          {minPrice === maxPrice ? formatIDR(minPrice) : `${formatIDR(minPrice)}–${formatIDR(maxPrice)}`}
                        </span>
                      </div>
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
                          {line.menuItemName}
                          {line.variantName ? (
                            <span className="text-[var(--color-text-secondary)]"> · {line.variantName}</span>
                          ) : null}
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
                      <QuantityStepper
                        size="sm"
                        value={line.quantity}
                        onDecrease={() => updateQuantity(line.key, -1)}
                        onIncrease={() => updateQuantity(line.key, 1)}
                      />
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
                className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 text-sm outline-none focus:border-[var(--color-accent-primary)]"
              />
              <Select
                value={paymentMethod}
                onChange={(v) => {
                  const next = v as (typeof PAYMENT_METHODS)[number];
                  setPaymentMethod(next);
                  if (next !== "card") setCardBank(null);
                }}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </Select>
            </div>

            {paymentMethod === "card" ? (
              <div className="mb-3">
                <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">Which bank?</span>
                <div className="flex gap-1 rounded-[var(--radius-sm)] bg-[var(--color-page-bg)] p-0.5">
                  {CARD_BANKS.map((bank) => (
                    <button
                      key={bank}
                      type="button"
                      onClick={() => setCardBank(bank)}
                      className={`flex-1 rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1.5 text-xs font-medium ${
                        cardBank === bank
                          ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
                          : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      {CARD_BANK_LABELS[bank]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

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
              <p role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
                {submitError}
              </p>
            ) : null}

            <Button
              size="lg"
              className="mt-3 w-full"
              disabled={cart.length === 0 || isSubmitting || !isOnline || (paymentMethod === "card" && !cardBank)}
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

function ItemThumbnail({ item }: { item: PosMenuItem }) {
  const [failed, setFailed] = useState(false);

  if (!item.imageUrl || failed) {
    return (
      <div className="flex h-24 w-full shrink-0 items-center justify-center bg-[var(--color-page-bg)]">
        <ImageOff size={20} className="text-[var(--color-text-muted)]" />
      </div>
    );
  }

  return (
    // Product photos live at cashier-pasted external URLs, not a fixed set of
    // remote hosts, so next/image's remotePatterns allowlist doesn't fit here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.imageUrl}
      alt=""
      className="h-24 w-full shrink-0 object-cover"
      onError={() => setFailed(true)}
    />
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
