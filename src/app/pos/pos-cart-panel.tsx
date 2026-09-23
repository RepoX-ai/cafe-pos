"use client";

import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { Select } from "@/components/ui/form-field";
import { formatIDR } from "@/lib/money/money";
import {
  CARD_BANK_LABELS,
  CARD_BANKS,
  CASH_TENDER_LABELS,
  CASH_TENDER_MODES,
  cartLineTotal,
  cashTenderPreset,
  PAYMENT_METHODS,
  type CardBank,
  type CartLine,
  type CashTenderMode,
  type OrderType,
  type PaymentMethod,
} from "./pos-order-options";

/**
 * The current order: lines, order options, totals, and the submit button.
 * Cart and checkout state stay in PosClient (they are persisted as one draft
 * and submitted together); this panel only renders them and reports edits.
 */
export function PosCartPanel({
  cart,
  mobileOpen,
  onClose,
  orderType,
  setOrderType,
  tableLabel,
  setTableLabel,
  paymentMethod,
  setPaymentMethod,
  cardBank,
  setCardBank,
  cashReceived,
  cashMode,
  setCashMode,
  customCash,
  setCustomCash,
  discountTotal,
  setDiscountTotal,
  subtotal,
  taxTotal,
  serviceChargeTotal,
  total,
  updateQuantity,
  removeLine,
  submitError,
  isSubmitting,
  isOnline,
  handleSubmit,
}: {
  cart: CartLine[];
  mobileOpen: boolean;
  onClose: () => void;
  orderType: OrderType;
  setOrderType: (value: OrderType) => void;
  tableLabel: string;
  setTableLabel: (value: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (value: PaymentMethod) => void;
  cardBank: CardBank | null;
  setCardBank: (value: CardBank | null) => void;
  cashReceived: number | null;
  cashMode: CashTenderMode | null;
  setCashMode: (value: CashTenderMode | null) => void;
  customCash: number | null;
  setCustomCash: (value: number | null) => void;
  discountTotal: number;
  setDiscountTotal: (value: number) => void;
  subtotal: number;
  taxTotal: number;
  serviceChargeTotal: number;
  total: number;
  updateQuantity: (key: string, delta: number) => void;
  removeLine: (key: string) => void;
  submitError: string | null;
  isSubmitting: boolean;
  isOnline: boolean;
  handleSubmit: () => void;
}) {
  // On a cash sale the tendered amount is required — an order can't be
  // submitted until it's entered. Null is "not entered yet", never zero.
  const isCash = paymentMethod === "cash";
  const changeDue = isCash && cashReceived !== null ? cashReceived - total : null;
  const isUnderTendered = changeDue !== null && changeDue < 0;
  const isCashMissing = isCash && cashReceived === null;
  const cashError = isUnderTendered
    ? `Cash received is ${formatIDR(-changeDue!)} short of the total.`
    : isCashMissing
      ? cashMode === "custom"
        ? "Enter the cash received to submit this order."
        : "Pick how the customer paid to submit this order."
      : null;

  function selectCashMode(mode: CashTenderMode) {
    setCashMode(mode);
    // Leaving "Lainnya" drops the typed amount so returning to it starts
    // clean rather than re-showing a figure the cashier moved away from.
    if (mode !== "custom") setCustomCash(null);
  }

  return (
    <aside id="pos-cart" aria-label="Current order" className={`${mobileOpen ? "flex" : "hidden"} fixed inset-0 z-30 min-h-0 w-full flex-col overflow-y-auto bg-[var(--color-surface)] max-lg:pb-[env(safe-area-inset-bottom)] lg:static lg:flex lg:w-[380px] lg:shrink-0 lg:overflow-hidden lg:border-l lg:border-[var(--color-border)]`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2"><button type="button" onClick={onClose} aria-label="Close order" className="rounded-[var(--radius-sm)] p-2 text-[var(--color-text-secondary)] lg:hidden"><X size={20} /></button><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Current order</h2></div>
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

      <div className="shrink-0 px-4 py-3 sm:px-5 lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto">
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
                    {formatIDR(cartLineTotal(line))}
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

      <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-4 sm:px-5">
        <div className="mb-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          <input
            value={tableLabel}
            onChange={(e) => setTableLabel(e.target.value)}
            placeholder="Table / customer"
            className="h-10 min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 text-sm outline-none focus:border-[var(--color-accent-primary)]"
          />
          <Select
            value={paymentMethod}
            onChange={(v) => {
              const next = v as (typeof PAYMENT_METHODS)[number];
              setPaymentMethod(next);
              if (next !== "card") setCardBank(null);
              if (next !== "cash") {
                setCashMode(null);
                setCustomCash(null);
              }
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

        {isCash ? (
          <div className="mb-3">
            <span id="cash-tender-label" className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
              Cash received
              <span aria-hidden="true" className="ml-0.5 text-[var(--color-danger)]">*</span>
            </span>
            <div role="group" aria-labelledby="cash-tender-label" className="flex gap-1 rounded-[var(--radius-sm)] bg-[var(--color-page-bg)] p-0.5">
              {CASH_TENDER_MODES.map((mode) => {
                const preset = cashTenderPreset(mode);
                // A note smaller than the bill can't settle it — don't offer
                // a tap that could only ever produce a shortfall.
                const tooSmall = preset !== null && preset < total;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={tooSmall}
                    aria-pressed={cashMode === mode}
                    onClick={() => selectCashMode(mode)}
                    className={`flex-1 rounded-[calc(var(--radius-sm)-2px)] px-1 py-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                      cashMode === mode
                        ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
                        : "text-[var(--color-text-muted)]"
                    }`}
                  >
                    {CASH_TENDER_LABELS[mode]}
                  </button>
                );
              })}
            </div>

            {cashMode === "custom" ? (
              <div className="mt-2 flex items-center justify-between">
                <label htmlFor="cash-received" className="text-sm text-[var(--color-text-secondary)]">
                  Jumlah (Rp)
                </label>
                <input
                  id="cash-received"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1000}
                  required
                  autoFocus
                  value={customCash ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setCustomCash(raw === "" ? null : Math.max(0, Math.round(Number(raw) || 0)));
                  }}
                  aria-invalid={isUnderTendered}
                  aria-describedby={cashError ? "cash-received-error" : undefined}
                  className={`h-8 w-28 rounded-[var(--radius-sm)] border px-2 text-right text-sm tabular-nums outline-none focus:border-[var(--color-accent-primary)] ${
                    isUnderTendered ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"
                  }`}
                />
              </div>
            ) : cashReceived !== null ? (
              <p className="mt-2 flex items-center justify-between text-sm text-[var(--color-text-secondary)]">
                <span>Tendered</span>
                <span className="tabular-nums text-[var(--color-text-primary)]">{formatIDR(cashReceived)}</span>
              </p>
            ) : null}
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
          {changeDue !== null ? (
            <div className="mt-1.5 flex items-center justify-between border-t border-[var(--color-border)] pt-1.5">
              <span className="text-base font-semibold text-[var(--color-text-primary)]">Change</span>
              <span
                className={`text-xl font-semibold tabular-nums ${
                  isUnderTendered ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"
                }`}
              >
                {isUnderTendered ? `-${formatIDR(-changeDue)}` : formatIDR(changeDue)}
              </span>
            </div>
          ) : null}
        </div>

        {cashError && cart.length > 0 ? (
          <p
            id="cash-received-error"
            role={isUnderTendered ? "alert" : undefined}
            className={`mt-2 text-xs ${isUnderTendered ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}
          >
            {cashError}
          </p>
        ) : null}

        {submitError ? (
          <p role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {submitError}
          </p>
        ) : null}

        <Button
          size="lg"
          className="mt-3 w-full"
          disabled={cart.length === 0 || isSubmitting || !isOnline || (paymentMethod === "card" && !cardBank) || isUnderTendered || isCashMissing}
          onClick={handleSubmit}
        >
          {isSubmitting ? "Submitting…" : `Submit order · ${formatIDR(total)}`}
        </Button>
      </div>
    </aside>
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
