import { describe, expect, it, vi } from "vitest";
import { requirePageAccess } from "@/lib/auth/guards";
import PosPage from "@/app/pos/page";

vi.mock("@/lib/auth/guards", () => ({ requirePageAccess: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/server/services/pos-menu-cache", () => ({ getCachedPosMenu: async () => ({ categories: [], items: [] }) }));
vi.mock("@/server/services/business-service", () => ({ getBusinessById: async () => null }));
vi.mock("@/app/pos/pos-client", () => ({ PosClient: () => null }));

async function render(businessId: string, id = "cashier") {
  vi.mocked(requirePageAccess).mockResolvedValue({ businessId, id, name: "Cashier", roles: ["cashier"], membershipCount: 1 } as Awaited<ReturnType<typeof requirePageAccess>>);
  return PosPage();
}

describe("POS cart scope", () => {
  it("preserves state on a catalog refresh but remounts for another store or cashier", async () => {
    const first = await render("store-a");
    expect(first.key).not.toBeNull();
    expect((await render("store-a")).key).toBe(first.key);
    expect((await render("store-b")).key).not.toBe(first.key);
    expect((await render("store-a", "other-cashier")).key).not.toBe(first.key);
  });
});
