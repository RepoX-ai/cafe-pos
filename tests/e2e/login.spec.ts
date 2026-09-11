import { test, expect } from "@playwright/test";

/**
 * Smoke test for the auth + role-routing foundation built in Phase 0.
 * Requires a migrated + seeded database (see playwright.config.ts).
 */
test.describe("login", () => {
  test("rejects bad credentials with a visible error, no redirect", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("owner@dev.local");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toContainText("Incorrect email or password");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("owner logs in and lands on the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("owner@dev.local");
    await page.getByLabel("Password").fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("cashier logs in and lands on the POS, not the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("cashier@dev.local");
    await page.getByLabel("Password").fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/pos$/);
  });

  test("cashier cannot reach the dashboard by typing the URL", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("cashier@dev.local");
    await page.getByLabel("Password").fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/pos$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/forbidden$/);
  });
});
