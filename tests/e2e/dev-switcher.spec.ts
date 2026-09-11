import { test, expect } from "@playwright/test";

/**
 * The dev-only one-click account switcher (src/components/dev-role-switcher.tsx).
 * Requires NODE_ENV !== "production" (true for `npm run dev`, which is
 * what playwright.config.ts's webServer runs) and a seeded database.
 */
test.describe("dev role switcher", () => {
  test("switches from owner to cashier and back without typing credentials", async ({ page }) => {
    const toggle = page.getByRole("button", { name: "Switch dev account" });

    await page.goto("/login");
    await toggle.click();
    await page.getByRole("button", { name: "Owner" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);

    await toggle.click();
    await page.getByRole("button", { name: "Cashier" }).click();

    await expect(page).toHaveURL(/\/pos$/);

    await toggle.click();
    await page.getByRole("button", { name: "Owner" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
