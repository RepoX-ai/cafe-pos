import { describe, expect, it } from "vitest";
import { cartLineSignature, cartDraftSchema } from "@/lib/pos/cart";
import { formatBusinessDate } from "@/lib/dates/dates";
import { imageExtension } from "@/server/services/menu-image-upload";

describe("checkout and image regressions", () => {
  it("does not merge different dishes without variants", () => {
    const a = { menuItemId: "rice", variantId: null, modifierOptionIds: [] };
    expect(cartLineSignature(a)).not.toBe(cartLineSignature({ ...a, menuItemId: "noodles" }));
  });
  it("merges identical selections regardless of modifier ordering", () => {
    const a = { menuItemId: "rice", variantId: "large", modifierOptionIds: ["egg", "chicken"] };
    expect(cartLineSignature(a)).toBe(cartLineSignature({ ...a, modifierOptionIds: ["chicken", "egg"] }));
    expect(cartLineSignature(a)).not.toBe(cartLineSignature({ ...a, notes: "no salt" }));
  });
  it("rejects malformed saved carts", () => {
    expect(cartDraftSchema.safeParse({ cart: [{}], orderType: "dine_in" }).success).toBe(false);
  });
  it("keeps Today on the Jakarta date before 07:00", () => {
    expect(formatBusinessDate(new Date("2026-09-12T01:00:00+07:00"))).toBe("2026-09-12");
  });
  it("rejects files whose advertised image type does not match the bytes", () => {
    expect(imageExtension(Buffer.from("<svg onload='bad'>"), "image/png")).toBeNull();
    expect(imageExtension(Buffer.from([255,216,255,0]), "image/jpeg")).toBe("jpg");
    expect(imageExtension(Buffer.from([255,216,255,0]), "image/png")).toBeNull();
  });
});
