import { test, expect } from "@playwright/test";

/**
 * Smoke test for the auth + role-routing foundation built in Phase 0.
 * Requires a migrated + seeded database (see playwright.config.ts).
 */
test.describe("login", () => {
  test("rejects bad credentials with a visible error, no redirect", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("owner@dev.local");
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Next.js's own route-announcer div also carries role="alert", so
    // scope to our error message's text instead of the bare role.
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("owner logs in and lands on the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("owner@dev.local");
    await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("cashier logs in and lands on the POS, not the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("cashier@dev.local");
    await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/pos$/);
  });

  test("cashier cannot reach the dashboard by typing the URL", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("cashier@dev.local");
    await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/pos$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test("cashier cannot reach the menu/recipe admin section (regression: menu:read must not leak COGS to cashiers)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("cashier@dev.local");
    await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/pos$/);

    await page.goto("/menu");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
