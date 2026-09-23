import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The POS menu cache is keyed per business (and per stock mode) and dropped
 * by tag. `unstable_cache` needs the Next.js runtime, so it is replaced with
 * a fake that honours the same contract — entries live under their key parts,
 * `revalidateTag` removes every entry carrying the tag — which is what these
 * tests exercise: that our keys and tags scope correctly per tenant, and that
 * an invalidation makes the next read hit the database again.
 */

const store = new Map<string, { value: unknown; tags: string[] }>();

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[], opts: { tags?: string[] }) => async () => {
    const key = JSON.stringify(keyParts);
    const hit = store.get(key);
    if (hit) return hit.value;
    const value = await fn();
    store.set(key, { value, tags: opts.tags ?? [] });
    return value;
  },
  revalidateTag: (tag: string) => {
    for (const [key, entry] of store) if (entry.tags.includes(tag)) store.delete(key);
  },
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));

const getPosMenu = vi.fn();
vi.mock("@/server/services/menu-service", () => ({
  getPosMenu: (...args: unknown[]) => getPosMenu(...args),
}));

import { getCachedPosMenu, invalidatePosMenuCache, posMenuCacheTag } from "@/server/services/pos-menu-cache";

const stocked = { allowNegativeStock: false };

describe("POS menu cache", () => {
  beforeEach(() => {
    store.clear();
    getPosMenu.mockReset();
    getPosMenu.mockImplementation(async (_db: unknown, businessId: string) => ({
      categories: [],
      items: [{ id: `item-of-${businessId}` }],
    }));
  });

  it("serves the second read from the cache", async () => {
    await getCachedPosMenu("biz-a", stocked);
    await getCachedPosMenu("biz-a", stocked);
    expect(getPosMenu).toHaveBeenCalledTimes(1);
  });

  it("re-reads the database after the business's cache is invalidated", async () => {
    await getCachedPosMenu("biz-a", stocked);
    invalidatePosMenuCache("biz-a");
    await getCachedPosMenu("biz-a", stocked);
    expect(getPosMenu).toHaveBeenCalledTimes(2);
  });

  it("returns the fresh value after an invalidation (update)", async () => {
    getPosMenu.mockResolvedValueOnce({ categories: [], items: [{ id: "old" }] });
    getPosMenu.mockResolvedValueOnce({ categories: [], items: [{ id: "new" }] });

    expect((await getCachedPosMenu("biz-a", stocked)).items[0].id).toBe("old");
    invalidatePosMenuCache("biz-a");
    expect((await getCachedPosMenu("biz-a", stocked)).items[0].id).toBe("new");
  });

  it("keeps one business's invalidation away from another's entry", async () => {
    await getCachedPosMenu("biz-a", stocked);
    await getCachedPosMenu("biz-b", stocked);
    getPosMenu.mockClear();

    invalidatePosMenuCache("biz-a");
    const b = await getCachedPosMenu("biz-b", stocked);
    expect(getPosMenu).not.toHaveBeenCalled();
    expect(b.items[0].id).toBe("item-of-biz-b");

    await getCachedPosMenu("biz-a", stocked);
    expect(getPosMenu).toHaveBeenCalledTimes(1);
  });

  it("never serves one business's menu to another", async () => {
    const a = await getCachedPosMenu("biz-a", stocked);
    const b = await getCachedPosMenu("biz-b", stocked);
    expect(a.items[0].id).toBe("item-of-biz-a");
    expect(b.items[0].id).toBe("item-of-biz-b");
  });

  it("caches the stock-checked and negative-stock variants separately, and invalidates both", async () => {
    await getCachedPosMenu("biz-a", { allowNegativeStock: false });
    await getCachedPosMenu("biz-a", { allowNegativeStock: true });
    expect(getPosMenu).toHaveBeenCalledTimes(2);

    invalidatePosMenuCache("biz-a");
    getPosMenu.mockClear();
    await getCachedPosMenu("biz-a", { allowNegativeStock: false });
    await getCachedPosMenu("biz-a", { allowNegativeStock: true });
    expect(getPosMenu).toHaveBeenCalledTimes(2);
  });

  it("scopes the tag to the business", () => {
    expect(posMenuCacheTag("biz-a")).not.toBe(posMenuCacheTag("biz-b"));
    expect(posMenuCacheTag("biz-a")).toContain("biz-a");
  });
});
