import { test, expect, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Workflows added or changed by the production-readiness work, run against a
 * production build (`next build && next start`) on a seeded, disposable
 * database. E2E_DATABASE_URL (the same database, owner credentials) lets the
 * tests assert what was actually written; without it they skip.
 *
 * Plain http://localhost: run with --project=android-tablet (Chromium) —
 * WebKit won't keep the production Secure session cookie over plain HTTP.
 */
const dbUrl = process.env.E2E_DATABASE_URL;
test.skip(!dbUrl, "E2E_DATABASE_URL not set");

async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Lets the next server-action POST to `path` reach the server, then drops its response. */
async function loseNextActionResponse(page: Page, path: string) {
  let dropped = false;
  await page.route(`**${path}`, async (route) => {
    const request = route.request();
    if (dropped || request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    dropped = true;
    await route.fetch(); // the server processes it...
    await route.abort("connectionreset"); // ...and the tablet never hears back
  });
}

test.describe("production workflows", () => {
  test("serves a nonce CSP with no violations on the main screens", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to (load|execute|apply)/i.test(m.text())) violations.push(m.text());
    });
    const response = await page.goto("/login");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

    await signIn(page, "owner@dev.local");
    for (const path of ["/dashboard", "/reports", "/purchases", "/menu", "/settings", "/pos"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(violations).toEqual([]);
  });

  test("switches business from the account menu and back", async ({ page }) => {
    const [owner] = await query<{ id: string }>("select id from users where email = 'owner@dev.local'");
    const name = `E2E Second Café ${Date.now()}`;
    await query(
      `with b as (insert into businesses (id, name, order_number_prefix) values (gen_random_uuid(), $1, 'E2E') returning id),
            m as (insert into memberships (id, user_id, business_id) select gen_random_uuid(), $2, id from b returning id)
       insert into membership_roles (membership_id, role_id) select m.id, r.id from m, roles r where r.name = 'owner'`,
      [name, owner.id],
    );

    try {
      await signIn(page, "owner@dev.local");
      const switchTo = async (target: RegExp) => {
        await page.waitForLoadState("networkidle");
        // The menu can still be open from the previous switch.
        const account = page.getByRole("button", { name: /Dev Owner/ });
        if ((await account.getAttribute("aria-expanded")) !== "true") await account.click();
        const group = page.getByRole("group", { name: "Switch business" });
        await expect(group).toBeVisible();
        await group.getByRole("menuitem", { name: target }).click();
      };
      await switchTo(new RegExp(name));
      await expect(page.getByRole("img", { name })).toBeVisible();
      await switchTo(/Fictional Coffee Co/);
      await expect(page.getByRole("img", { name: /Fictional Coffee Co/ })).toBeVisible();
    } finally {
      // Login lands in the most recently used business; don't leave later tests in this one.
      await query(
        `delete from memberships where user_id = $1 and business_id in (select id from businesses where name like 'E2E Second Café%')`,
        [owner.id],
      );
    }
  });

  test("recovers a checkout whose response was lost, recording one order", async ({ page }) => {
    await signIn(page, "cashier@dev.local");
    await expect(page).toHaveURL(/\/pos$/);
    const [{ n: before }] = await query<{ n: number }>("select count(*)::int as n from orders");

    await loseNextActionResponse(page, "/pos");
    await page.getByRole("button", { name: /Coffee A/ }).click();
    await page.getByRole("button", { name: "Uang pas" }).click();
    await page.getByRole("button", { name: /Submit order/ }).click();
    const retry = page.getByRole("button", { name: "Retry saved order" });
    await expect(retry).toBeVisible();

    await retry.click();
    await expect(page.getByText("Order submitted")).toBeVisible();
    const [{ n: after }] = await query<{ n: number }>("select count(*)::int as n from orders");
    expect(after - before).toBe(1);
  });

  test("records a purchase receipt once when its response is lost and it is resubmitted", async ({ page }) => {
    await signIn(page, "owner@dev.local");
    await page.goto("/purchases");
    const [{ q: stockBefore, n: purchasesBefore }] = await query<{ q: string; n: number }>(
      `select (select current_quantity_base_units from ingredients where name = 'Coffee beans' and business_id = (select business_id from memberships m join users u on u.id = m.user_id where u.email = 'owner@dev.local' order by m.created_at limit 1)) as q,
              (select count(*)::int from purchases) as n`,
    );

    const row = page.getByRole("table").getByRole("row").nth(1);
    await row.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Coffee beans/ }).click();
    await row.getByRole("spinbutton").first().fill("2");
    await row.getByRole("combobox").nth(1).click();
    await page.getByRole("option").first().click();
    await row.getByRole("spinbutton").nth(1).fill("50000");

    await loseNextActionResponse(page, "/purchases");
    await page.getByRole("button", { name: "Finalize receipt" }).click();
    await expect(page.getByText(/Couldn't reach the server/).first()).toBeVisible();

    await page.getByRole("button", { name: "Finalize receipt" }).click();
    await expect(page.getByText(/Purchase receipt finalized/)).toBeVisible();

    const [{ q: stockAfter, n: purchasesAfter }] = await query<{ q: string; n: number }>(
      `select (select current_quantity_base_units from ingredients where name = 'Coffee beans' and business_id = (select business_id from memberships m join users u on u.id = m.user_id where u.email = 'owner@dev.local' order by m.created_at limit 1)) as q,
              (select count(*)::int from purchases) as n`,
    );
    expect(purchasesAfter - purchasesBefore).toBe(1);
    expect(Number(stockAfter)).toBeGreaterThan(Number(stockBefore));
    // Exactly one receipt's worth: the stock moved by one PURCHASE_RECEIPT line.
    const [{ moved }] = await query<{ moved: string }>(
      `select sum(quantity_base_units) as moved from inventory_movements
       where movement_type = 'PURCHASE_RECEIPT' and source_id = (select id from purchases order by created_at desc limit 1)`,
    );
    expect(Number(stockAfter) - Number(stockBefore)).toBe(Number(moved));
  });

  test("saves a new recipe version and keeps exactly one active", async ({ page }) => {
    const [item] = await query<{ id: string; variant_id: string }>(
      `select i.id, v.id as variant_id from menu_items i join menu_item_variants v on v.menu_item_id = i.id where i.name = 'Coffee A' limit 1`,
    );
    const [{ v: versionBefore }] = await query<{ v: number }>("select max(version)::int as v from recipes where menu_item_variant_id = $1", [item.variant_id]);

    await signIn(page, "owner@dev.local");
    await page.goto(`/menu/${item.id}/recipe`);
    const quantity = page.getByRole("table").getByRole("spinbutton").first();
    const current = Number(await quantity.inputValue());
    await quantity.fill(String(current + 1));
    await page.getByRole("button", { name: "Save recipe" }).click();
    await expect(page.getByRole("button", { name: "Save recipe" })).toBeEnabled();

    await expect
      .poll(async () => (await query<{ v: number }>("select max(version)::int as v from recipes where menu_item_variant_id = $1", [item.variant_id]))[0].v)
      .toBe(versionBefore + 1);
    const [{ n: active }] = await query<{ n: number }>("select count(*)::int as n from recipes where menu_item_variant_id = $1 and active", [item.variant_id]);
    expect(active).toBe(1);
  });

  test("downloads a CSV export and caps an over-long range", async ({ page }) => {
    await signIn(page, "owner@dev.local");
    await page.goto("/reports?type=inventory_movements");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
    const body = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(body).toString("utf8");
    expect(text.split("\r\n")[0]).toBe("When,Type,Quantity,Value (Rp),Reason");

    const response = await page.request.get("/api/exports/reports?type=inventory_movements&from=2000-01-01&to=2099-12-31");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("inventory_movements_2098-12-31_2099-12-31.csv");
  });
});
