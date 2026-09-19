import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/lib/db/client";
import { getPosMenu, type PosCategory, type PosMenuItem } from "./menu-service";

/** Short TTL so stock badges stay roughly fresh without rebuilding on every /pos load. */
const POS_MENU_REVALIDATE_SECONDS = 20;

export function posMenuCacheTag(businessId: string): string {
  return `pos-menu:${businessId}`;
}

/**
 * Cached POS catalog (PERF-001). Keyed by business + whether stock is gated.
 * Menu/stock mutations call `invalidatePosMenuCache`; otherwise entries expire
 * after {@link POS_MENU_REVALIDATE_SECONDS}.
 */
export function getCachedPosMenu(
  businessId: string,
  opts: { allowNegativeStock: boolean },
): Promise<{ categories: PosCategory[]; items: PosMenuItem[] }> {
  const stockKey = opts.allowNegativeStock ? "neg" : "stock";
  return unstable_cache(
    async () => getPosMenu(db, businessId, opts),
    ["pos-menu", businessId, stockKey],
    { revalidate: POS_MENU_REVALIDATE_SECONDS, tags: [posMenuCacheTag(businessId)] },
  )();
}

/** Drop the cached POS menu for a business (call from Server Actions after menu/stock writes). */
export function invalidatePosMenuCache(businessId: string): void {
  revalidateTag(posMenuCacheTag(businessId), { expire: 0 });
}
