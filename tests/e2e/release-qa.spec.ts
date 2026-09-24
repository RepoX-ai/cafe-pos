import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import pg from "pg";

test.skip(!process.env.E2E_DATABASE_URL, "E2E_DATABASE_URL not set");

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.end(); }
}

/** Each case gets its own tenant so pricing, cache, and stock cannot leak between tests. */
async function fixture(inclusive = false) {
  const business = randomUUID(), user = randomUUID(), membership = randomUUID();
  const ingredient = randomUUID(), item = randomUUID(), variant = randomUUID(), recipe = randomUUID();
  const email = `qa-${user}@test.local`;
  await query("insert into businesses (id,name,order_number_prefix,tax_config,service_charge_percent) values ($1,'QA Cafe','QA',$2,$3)", [business, inclusive ? JSON.stringify({ percent: 11, inclusive: true }) : null, inclusive ? "10" : null]);
  await query("insert into users (id,name,email,password_hash) select $1,'QA Owner',$2,password_hash from users where email='owner@dev.local'", [user,email]);
  await query("insert into memberships (id,user_id,business_id) values ($1,$2,$3)", [membership,user,business]);
  await query("insert into membership_roles (membership_id,role_id) select $1,id from roles where name='owner'", [membership]);
  await query("insert into ingredients (id,business_id,name,base_unit,current_quantity_base_units,average_cost_per_base_unit) values ($1,$2,'QA Beans','gram',1000,10)", [ingredient,business]);
  await query("insert into menu_items (id,business_id,name,base_price) values ($1,$2,'QA Coffee',$3)", [item,business,inclusive ? 111000 : 25000]);
  await query("insert into menu_item_variants (id,menu_item_id,name,price) values ($1,$2,'Regular',$3)", [variant,item,inclusive ? 111000 : 25000]);
  await query("insert into recipes (id,business_id,menu_item_variant_id) values ($1,$2,$3)", [recipe,business,variant]);
  await query("insert into recipe_lines (id,business_id,recipe_id,ingredient_id,quantity_base_units) values (gen_random_uuid(),$1,$2,$3,20)", [business,recipe,ingredient]);
  return { business, user, ingredient, item, variant, email };
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function addCoffee(page: Page) {
  await page.goto("/pos");
  await page.getByRole("button", { name: /QA Coffee/ }).click();
}

test("inclusive tax, discount, service, cash change and report profit agree", async ({ page }) => {
  const fx = await fixture(true);
  await login(page, fx.email);
  await addCoffee(page);
  await page.getByLabel("Discount (Rp)").fill("11100");
  await expect(page.getByText("Tax (included)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit order/ })).toContainText("Rp109.890");
  await page.getByRole("button", { name: "Lainnya", exact: true }).click();
  await page.getByLabel("Jumlah (Rp)").fill("100000");
  await expect(page.getByRole("button", { name: /Submit order/ })).toBeDisabled();
  await page.getByLabel("Jumlah (Rp)").fill("150000");
  await page.getByRole("button", { name: /Submit order/ }).click();
  await expect(page.getByText("Order submitted", { exact: true })).toBeVisible();
  const [order] = await query("select * from orders where business_id=$1", [fx.business]);
  expect(order).toMatchObject({ subtotal: 111000, discount_total: 11100, tax_total: 9900, service_charge_total: 9990, total: 109890, cash_received: 150000, change_due: 40110, cogs_total: 200, gross_profit: 89800 });
  const [stock] = await query("select current_quantity_base_units as quantity from ingredients where id=$1", [fx.ingredient]);
  expect(Number(stock.quantity)).toBe(980);
  await page.goto(`/orders/${order.id}`);
  await expect(page.getByText("Tax (included)", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Net sales/ })).toContainText("Rp90.000");
  await page.goto("/dashboard");
  await expect(page.getByText("Rp89.800", { exact: true }).first()).toBeVisible();
});

test("price changes reject the stale cart and allow a reviewed replacement", async ({ page }) => {
  test.setTimeout(60_000);
  const fx = await fixture();
  await login(page, fx.email);
  await addCoffee(page);
  await page.getByRole("button", { name: "50.000", exact: true }).click();
  await query("update menu_item_variants set price=30000 where id=$1", [fx.variant]);
  await page.getByRole("button", { name: /Submit order/ }).click();
  await expect(page.getByText(/Prices or charges have changed/).first()).toBeVisible();
  expect(await query("select id from orders where business_id=$1", [fx.business])).toHaveLength(0);
  await expect(page.getByRole("button", { name: /Submit order/ })).toBeEnabled();
  // The rejection must invalidate stale menu data so re-adding works immediately.
  await expect(page.getByRole("button", { name: /QA Coffee/ })).toContainText("Rp30.000");
  await page.getByRole("button", { name: "Remove line", exact: true }).click();
  await page.getByRole("button", { name: /QA Coffee/ }).click();
  await page.getByRole("button", { name: /Submit order/ }).click();
  await expect(page.getByText("Order submitted", { exact: true })).toBeVisible();
  expect(await query("select total from orders where business_id=$1", [fx.business])).toMatchObject([{ total: 30_000 }]);
});

test("owner screens and all report types load without runtime errors or broken internal links", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fx = await fixture();
  await login(page, fx.email);
  const paths = ["/dashboard", "/orders", "/menu", `/menu/${fx.item}`, `/menu/${fx.item}/recipe`, "/ingredients", "/inventory", "/purchases", "/waste", "/expenses", "/settings", "/settings/staff", "/settings/audit", "/account/password", "/pos/orders"];
  const internalLinks = new Set<string>();
  for (const path of paths) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
    for (const link of await page.locator('a[href^="/"]').evaluateAll((links) => links.map((a) => a.getAttribute("href")!))) internalLinks.add(link);
  }
  for (const type of ["sales_by_day", "sales_by_menu_item", "sales_by_category", "sales_by_payment_method", "cancelled_refunded", "current_stock", "low_stock", "inventory_movements", "purchases", "waste", "expenses"]) {
    const response = await page.goto(`/reports?type=${type}`);
    expect(response?.status(), type).toBe(200);
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
  }
  for (const path of internalLinks) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBeLessThan(400);
  }
  expect(errors).toEqual([]);
});

test("an interrupted refund can be retried without duplicating stock reversal", async ({ page }) => {
  const fx = await fixture();
  await login(page, fx.email);
  await addCoffee(page);
  await page.getByRole("button", { name: "Uang pas" }).click();
  await page.getByRole("button", { name: /Submit order/ }).click();
  await expect(page.getByText("Order submitted", { exact: true })).toBeVisible();
  const [order] = await query("select id from orders where business_id=$1", [fx.business]);
  await page.goto(`/orders/${order.id}`);
  await page.getByRole("button", { name: "Refund order", exact: true }).click();
  await page.getByPlaceholder("Refund order reason").fill("QA refund");
  let dropped = false;
  await page.route(`**/orders/${order.id}`, async (route) => {
    if (dropped || route.request().method() !== "POST") return route.continue();
    dropped = true;
    await route.fetch();
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "Confirm refund order" }).click();
  await expect(page.getByText(/Couldn't confirm the refund/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm refund order" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm refund order" }).click();
  await expect(page.getByText("Order refunded.", { exact: true })).toBeVisible();
  const [stock] = await query("select current_quantity_base_units as quantity from ingredients where id=$1", [fx.ingredient]);
  expect(Number(stock.quantity)).toBe(1000);
  const [reversals] = await query("select count(*)::int as n from inventory_movements where source_id=$1 and movement_type='REFUND_REVERSAL'", [order.id]);
  expect(reversals.n).toBe(1);
});

test("stock count cannot review a missing or invalid quantity", async ({ page }) => {
  const fx = await fixture();
  await login(page, fx.email);
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Stock count", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await expect(dialog.getByRole("button", { name: "Review count" })).toBeDisabled();
  await dialog.getByRole("spinbutton").fill("-1");
  await expect(dialog.getByRole("button", { name: "Review count" })).toBeDisabled();
  await dialog.getByRole("spinbutton").fill("0");
  await dialog.getByRole("button", { name: "Review count" }).click();
  await expect(dialog.getByRole("heading", { name: "Review adjustments" })).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm & submit count" }).click();
  await expect(page.getByText("Stock count submitted.", { exact: true })).toBeVisible();
  const [stock] = await query("select current_quantity_base_units as quantity from ingredients where id=$1", [fx.ingredient]);
  expect(Number(stock.quantity)).toBe(0);
});

test("a store switched in another tab cannot overwrite the original cart", async ({ page, context }) => {
  const a = await fixture(), b = await fixture();
  const membership = randomUUID();
  await query("update businesses set name='QA Other Cafe' where id=$1", [b.business]);
  await login(page, a.email);
  await query("insert into memberships (id,user_id,business_id) values ($1,$2,$3)", [membership,a.user,b.business]);
  await query("insert into membership_roles (membership_id,role_id) select $1,id from roles where name='owner'", [membership]);
  await addCoffee(page);
  const draftA = `cafepos.pos.draft.v1:${a.business}:${a.user}`;
  const draftB = `cafepos.pos.draft.v1:${b.business}:${a.user}`;
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").cart?.length, draftA)).toBe(1);
  const other = await context.newPage();
  await other.goto("/dashboard");
  await other.getByRole("button", { name: /QA Owner/ }).click();
  await other.getByRole("group", { name: "Switch business" }).getByRole("menuitem", { name: /QA Other Cafe/ }).click();
  await expect(other.getByRole("img", { name: "QA Other Cafe" })).toBeVisible();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("img", { name: "QA Other Cafe" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Cart is empty. Tap a menu item to add it.")).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).cart.length, draftA)).toBe(1);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").cart?.length, draftB)).toBe(0);
  await other.close();
});
