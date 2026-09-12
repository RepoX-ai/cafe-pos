import { describe, expect, it } from "vitest";
import { menuItemInputSchema } from "../../src/lib/validation/menu";
import { matsudonImageUrl, matsudonMenuImages } from "../../scripts/matsudon-menu-images";

describe("bundled menu image URLs", () => {
  it("allows saving an existing item with any bundled photo", () => {
    for (const item of matsudonMenuImages) {
      const result = menuItemInputSchema.safeParse({
        name: item.name,
        basePrice: 1000,
        imageUrl: matsudonImageUrl(item.name),
      });
      expect(result.success, item.name).toBe(true);
    }
  });

  it("does not allow arbitrary paths through the bundled-photo rule", () => {
    for (const imageUrl of ["/images/menu/matsudon/../other.webp", "//example.com/a.webp", "/images/other.webp"]) {
      expect(menuItemInputSchema.safeParse({ name: "Test", basePrice: 1000, imageUrl }).success).toBe(false);
    }
  });
});
