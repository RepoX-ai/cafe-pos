import { test, expect } from "@playwright/test";

/**
 * Checkout through the `device` (tablet Bluetooth) provider, using
 * `?printer=sim` so the whole flow — queue the job, hand it to the client,
 * print, report the outcome, mark it PRINTED — runs without the physical
 * printer, which lives in the café.
 *
 * Requires PRINT_PROVIDER=device on the dev server, plus a migrated and
 * seeded database (see playwright.config.ts). Skips itself otherwise
 * rather than failing for the wrong reason.
 */
test.describe("POS checkout prints to the tablet printer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("cashier@dev.local");
    await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("prints the receipt and records it as printed", async ({ page }) => {
    await page.goto("/pos?printer=sim");

    await page.getByRole("button", { name: "Connect printer" }).click();
    await expect(page.getByRole("button", { name: /Simulated printer/ })).toBeVisible();

    await page.getByRole("button", { name: /Coffee A/ }).click();
    await page.getByRole("button", { name: /Submit order/ }).click();
    await expect(page.getByText("Order submitted")).toBeVisible();

    const orderNumber = await page.getByText(/^DEV-\d{5}$/).innerText();

    // The job is only "printed" once the client reported the outcome back.
    await expect(page.getByText("printed", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByText("Simulated paper output").click();
    const paper = await page.locator("pre").first().innerText();
    expect(paper).toContain(orderNumber);
    expect(paper).toContain("Coffee A");
    expect(paper).toContain("TOTAL");
  });

  test("offers to connect when checkout happens with no printer attached", async ({ page }) => {
    await page.goto("/pos?printer=sim");

    // Deliberately skip Connect printer.
    await page.getByRole("button", { name: /Coffee A/ }).click();
    await page.getByRole("button", { name: /Submit order/ }).click();
    await expect(page.getByText("Order submitted")).toBeVisible();

    // The order is saved either way — printing must never block it.
    await expect(page.getByText(/^DEV-\d{5}$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect printer and print" })).toBeVisible();

    await page.getByRole("button", { name: "Connect printer and print" }).click();
    await expect(page.getByText("printed", { exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
