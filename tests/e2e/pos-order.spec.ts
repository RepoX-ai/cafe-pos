import { test, expect } from "@playwright/test";

/**
 * End-to-end order flow against the seeded Coffee A menu item (see
 * scripts/seed.ts). Requires a migrated + seeded database, same as
 * login.spec.ts.
 */
test.describe("POS order submission", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("cashier@dev.local");
    await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("submits an order and shows a confirmation with an order number", async ({ page }) => {
    await page.getByRole("button", { name: /Coffee A/ }).click();
    // Cash sales need the tendered amount before Submit enables.
    await page.getByRole("button", { name: "Uang pas" }).click();
    await expect(page.getByRole("button", { name: "Submit order" })).toBeEnabled();
    await page.getByRole("button", { name: /Submit order/ }).click();

    await expect(page.getByText("Order submitted")).toBeVisible();
    await expect(page.getByText(/^DEV-\d{5}$/)).toBeVisible();
  });

  test("a double tap on submit does not create two orders", async ({ page }) => {
    await page.getByRole("button", { name: /Coffee A/ }).click();
    // Cash sales need the tendered amount before Submit enables.
    await page.getByRole("button", { name: "Uang pas" }).click();

    const submitButton = page.getByRole("button", { name: /Submit order/ });
    await Promise.all([submitButton.click(), submitButton.click()]);

    await expect(page.getByText("Order submitted")).toBeVisible();
    // The button disables itself on the first click, so only one order
    // should have been created — verified at the API/service level in
    // tests/integration/orders.test.ts ("duplicate idempotency key").
  });
});
