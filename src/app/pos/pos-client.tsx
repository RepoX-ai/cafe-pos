"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cartDraftSchema, cartLineSignature } from "@/lib/pos/cart";
import { submitOrderInputSchema, type SubmitOrderInput } from "@/lib/validation/order";
import type { PrintJobPayload } from "@/printing/printer-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, History, LogOut, Printer, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PosCategory, PosMenuItem } from "@/server/services/menu-service";
import type { TaxConfig } from "@/lib/settings/tax";
import { calculateServiceCharge, calculateTax } from "@/lib/settings/tax";
import { sumRupiah } from "@/lib/money/money";
import { logoutAction } from "@/app/(auth)/login/actions";
import { BrandLogo } from "@/components/brand-logo";
import { BusinessSwitcher, type BusinessOption } from "@/components/business-switcher";
import { submitOrderAction } from "./actions";
import { ItemModal, type ConfiguredLine } from "./item-modal";
import { useToast } from "@/components/ui/toast";
import { useBluetoothPrinter } from "./use-bluetooth-printer";
import { PosCartPanel } from "./pos-cart-panel";
import { PosMenuPanel } from "./pos-menu-panel";
import { PosOrderConfirmation } from "./pos-order-confirmation";
import {
  CARD_BANK_LABELS,
  cartLineTotal,
  PAYMENT_METHODS,
  resolveCashReceived,
  type CardBank,
  type CartLine,
  type CashTenderMode,
  type OrderType,
  type PaymentMethod,
} from "./pos-order-options";

const DRAFT_KEY = "cafepos.pos.draft.v1";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random()}`;
}

export function PosClient({
  draftScope,
  userName,
  roleLabel,
  businessName,
  businessOptions,
  activeMembershipId,
  categories,
  items,
  tax,
  serviceChargePercent,
  canViewOrderHistory,
}: {
  draftScope: string;
  userName: string;
  roleLabel: string;
  businessName: string;
  businessOptions: BusinessOption[];
  activeMembershipId: string;
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const storeMenuRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [configuring, setConfiguring] = useState<PosMenuItem | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [tableLabel, setTableLabel] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cardBank, setCardBank] = useState<CardBank | null>(null);
  // How the cash was tendered, and the typed amount behind "Lainnya". The
  // tendered figure itself is derived from these plus the total, below.
  const [cashMode, setCashMode] = useState<CashTenderMode | null>(null);
  const [customCash, setCustomCash] = useState<number | null>(null);
  const paymentMethodLabel =
    paymentMethod === "card" && cardBank ? `card (${CARD_BANK_LABELS[cardBank]})` : paymentMethod;
  const [discountTotal, setDiscountTotal] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    orderNumber: string;
    total: number;
    cashReceived: number | null;
    changeDue: number | null;
    printStatus: string;
    receipt?: PrintJobPayload;
    devicePrintJobId?: string;
    devicePrintToken?: string;
  } | null>(null);
  const printer = useBluetoothPrinter();
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen]);

  /**
   * The cart itself is safe to leave behind: the draft is keyed by
   * business (see `draftScope`), so it stays saved under this store and
   * comes back when the cashier returns.
   *
   * An order that was submitted but never confirmed is not. It is only
   * retryable from this store's POS, and switching away would hide the
   * retry banner while the order may or may not have reached the server —
   * so that one case blocks the switch.
   */
  function confirmStoreChange() {
    if (pending || isSubmitting) {
      showToast("error", "Finish the order that's waiting to be confirmed before changing store.");
      return false;
    }
    setStoreMenuOpen(false);
    return true;
  }

  useEffect(() => {
    if (!storeMenuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (storeMenuRef.current && !storeMenuRef.current.contains(e.target as Node)) setStoreMenuOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setStoreMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [storeMenuOpen]);

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
        setCashMode(draft.cashMode);
        setCustomCash(draft.customCash);
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
      localStorage.setItem(draftKey, JSON.stringify({ cart, orderType, tableLabel, discountTotal, idempotencyKey, paymentMethod, cardBank, cashMode, customCash }));
    } catch {
      // storage unavailable (private mode, quota) — cart still works in-memory
    }
  }, [cart, orderType, tableLabel, discountTotal, idempotencyKey, paymentMethod, cardBank, cashMode, customCash, draftLoaded, draftKey]);

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

  // The tablet keeps this page open all day, so a menu item, variant or
  // price changed in the admin UI would otherwise not appear until someone
  // reloaded. Re-read the server props when the page comes back to the
  // foreground, reconnects, or has simply been idle for a minute.
  // router.refresh() reconciles rather than remounts, so the cart and the
  // rest of the client state survive it.
  const router = useRouter();
  const busy = useRef(false);
  useEffect(() => {
    busy.current = isSubmitting || configuring !== null || confirmation !== null || pending !== null;
  });

  useEffect(() => {
    const IDLE_REFRESH_MS = 60_000;
    function refreshCatalog() {
      if (busy.current || document.hidden || !navigator.onLine) return;
      router.refresh();
    }
    const timer = setInterval(refreshCatalog, IDLE_REFRESH_MS);
    window.addEventListener("focus", refreshCatalog);
    window.addEventListener("online", refreshCatalog);
    document.addEventListener("visibilitychange", refreshCatalog);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshCatalog);
      window.removeEventListener("online", refreshCatalog);
      document.removeEventListener("visibilitychange", refreshCatalog);
    };
  }, [router]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeCategory !== "all" && item.categoryId !== activeCategory) return false;
      if (search.trim() && !item.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [items, activeCategory, search]);

  const subtotal = sumRupiah(cart.map(cartLineTotal));
  const netSales = Math.max(0, subtotal - discountTotal);
  const taxTotal = calculateTax(netSales, tax);
  const serviceChargeTotal = calculateServiceCharge(netSales, serviceChargePercent);
  const total = netSales + taxTotal + serviceChargeTotal;
  const cashReceived = paymentMethod === "cash" ? resolveCashReceived(cashMode, customCash, total) : null;

  function addToCart(line: ConfiguredLine) {
    // Most submission failures are about what is in the cart — a shortage,
    // an item that went inactive. Editing the cart makes that message stale,
    // so it goes with the edit rather than sitting there until the next tap.
    setSubmitError(null);
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
    setSubmitError(null);
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(key: string) {
    setSubmitError(null);
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function resetOrder() {
    setCart([]);
    setTableLabel("");
    setDiscountTotal(0);
    setCashMode(null);
    setCustomCash(null);
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
    // Cash sales must record what the customer handed over. The server
    // rejects an under-tender too; stopping here keeps the cashier from
    // burning the idempotency key on a doomed submission.
    if (!pending && paymentMethod === "cash" && (cashReceived === null || cashReceived < total)) return;
    setIsSubmitting(true);
    setSubmitError(null);

    const request = pending ?? {
      idempotencyKey,
      orderType,
      tableLabel: tableLabel || undefined,
      paymentMethodLabel,
      discountTotal,
      cashReceived: paymentMethod === "cash" && cashReceived !== null ? cashReceived : undefined,
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
        setConfirmation({
          orderNumber: result.orderNumber,
          total: result.total,
          cashReceived: result.cashReceived,
          changeDue: result.changeDue,
          printStatus: result.printStatus,
          receipt: result.receipt,
          devicePrintJobId: result.devicePrintJobId,
          devicePrintToken: result.devicePrintToken,
        });
        setCart([]);
        setTableLabel("");
        setDiscountTotal(0);
        setCashMode(null);
        setCustomCash(null);
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
    return <PosOrderConfirmation confirmation={confirmation} resetOrder={resetOrder} printer={printer} />;
  }

  return (
    <div className="force-light-theme flex h-screen flex-col bg-[var(--color-page-bg)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
        <div className="flex items-center gap-3">
          {businessOptions.length > 1 ? (
            <div ref={storeMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setStoreMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={storeMenuOpen}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] py-1 pl-1 pr-2 text-left hover:bg-[var(--color-selected-surface)]"
              >
                <BrandLogo className="h-9" />
                <span className="min-w-0 max-w-[13rem]">
                  <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {businessName}
                  </span>
                  <span className="block text-xs text-[var(--color-text-muted)]">Change store</span>
                </span>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${storeMenuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {storeMenuOpen ? (
                <div
                  role="menu"
                  className="absolute left-0 z-20 mt-1.5 w-64 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg"
                >
                  <BusinessSwitcher
                    options={businessOptions}
                    activeMembershipId={activeMembershipId}
                    onBeforeSwitch={confirmStoreChange}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <BrandLogo className="h-9" />
          )}
          {!isOnline ? (
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-danger-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-danger)]">
              <WifiOff size={12} />
              Offline — orders can&apos;t be submitted
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              printer.connect().catch((error) =>
                showToast("error", error instanceof Error ? error.message : "Could not connect to the printer."),
              )
            }
            className={`flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-xs font-medium ${
              printer.isConnected
                ? "border-[var(--color-success)] text-[var(--color-success)]"
                : "border-[var(--color-border)] hover:bg-[var(--color-selected-surface)]"
            }`}
          >
            <Printer size={12} />
            {printer.isConnected ? (printer.deviceName ?? "Printer ready") : "Connect printer"}
            {printer.isAsleep ? " (asleep)" : ""}
          </button>
          {canViewOrderHistory ? (
            <Link
              href="/pos/orders"
              className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium hover:bg-[var(--color-selected-surface)]"
            >
              <History size={12} />
              Order history
            </Link>
          ) : null}
          <div ref={userMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pl-1.5 pr-1.5 text-left hover:bg-[var(--color-selected-surface)]"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-selected-surface)] text-xs font-semibold text-[var(--color-accent-primary)]">
                {initials(userName)}
              </div>
              <div>
                <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{userName}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{roleLabel}</p>
              </div>
              <ChevronDown
                size={16}
                className={`shrink-0 text-[var(--color-text-muted)] transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {userMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1.5 w-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg"
              >
                <form action={logoutAction}>
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-page-bg)] hover:text-[var(--color-danger)]"
                  >
                    <LogOut size={16} className="shrink-0" />
                    Log out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {pending ? <div role="alert" className="p-4">A submission needs confirmation. <Button disabled={isSubmitting || !isOnline} onClick={handleSubmit}>Retry saved order</Button>{submitError ? <p>{submitError}</p> : null}</div> : null}
      <div inert={!!pending || isSubmitting || !draftLoaded} className="flex min-h-0 flex-1">
        <PosMenuPanel
          categories={categories}
          filteredItems={filteredItems}
          search={search}
          setSearch={setSearch}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          handleItemTap={handleItemTap}
        />

        <PosCartPanel
          cart={cart}
          orderType={orderType}
          setOrderType={setOrderType}
          tableLabel={tableLabel}
          setTableLabel={setTableLabel}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          cardBank={cardBank}
          setCardBank={setCardBank}
          cashReceived={cashReceived}
          cashMode={cashMode}
          setCashMode={setCashMode}
          customCash={customCash}
          setCustomCash={setCustomCash}
          discountTotal={discountTotal}
          setDiscountTotal={setDiscountTotal}
          subtotal={subtotal}
          taxTotal={taxTotal}
          serviceChargeTotal={serviceChargeTotal}
          total={total}
          updateQuantity={updateQuantity}
          removeLine={removeLine}
          submitError={submitError}
          isSubmitting={isSubmitting}
          isOnline={isOnline}
          handleSubmit={handleSubmit}
        />
      </div>

      {configuring ? (
        <ItemModal item={configuring} onClose={() => setConfiguring(null)} onAdd={addToCart} />
      ) : null}
    </div>
  );
}
