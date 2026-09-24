import { test, expect } from "@playwright/test";

/**
 * The dev-only one-click account switcher (src/components/dev-role-switcher.tsx).
 * Requires NODE_ENV !== "production" (true for `npm run dev`, which is
 * what playwright.config.ts's webServer runs) and a seeded database.
 */
test.describe("dev role switcher", () => {
  test("switches from owner to cashier and back without typing credentials", async ({ page }) => {
    const toggle = page.getByRole("button", { name: "Switch dev account" });
    const switcher = page.getByText("Dev: switch account", { exact: true }).locator("..");

    await page.goto("/login");
    await toggle.click();
    await switcher.getByRole("button", { name: "Owner", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard$/);

    if (!(await page.getByText("Dev: switch account", { exact: true }).isVisible())) await toggle.click();
    await switcher.getByRole("button", { name: "Cashier", exact: true }).click();

    await expect(page).toHaveURL(/\/pos$/);

    if (!(await page.getByText("Dev: switch account", { exact: true }).isVisible())) await toggle.click();
    await switcher.getByRole("button", { name: "Owner", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
