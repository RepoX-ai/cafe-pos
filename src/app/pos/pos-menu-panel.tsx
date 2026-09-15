"use client";

import { useState } from "react";
import { ImageOff, Search } from "lucide-react";
import type { PosCategory, PosMenuItem } from "@/server/services/menu-service";
import { formatIDR } from "@/lib/money/money";

/** Menu search, category filter, and item grid. Filter state lives in PosClient. */
export function PosMenuPanel({
  categories,
  filteredItems,
  search,
  setSearch,
  activeCategory,
  setActiveCategory,
  handleItemTap,
}: {
  categories: PosCategory[];
  filteredItems: PosMenuItem[];
  search: string;
  setSearch: (value: string) => void;
  activeCategory: string | "all";
  setActiveCategory: (value: string | "all") => void;
  handleItemTap: (item: PosMenuItem) => void;
}) {
  return (
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
