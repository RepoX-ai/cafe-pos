import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Browser checks for three fixes: a stale café tab can't write into the
 * café another tab switched to; date fields default to the Jakarta date
 * just after midnight; and the POS judges a variant plus its modifiers
 * together. Run against a seeded, disposable database (E2E_DATABASE_URL).
 */
test.skip(!process.env.E2E_DATABASE_URL, "E2E_DATABASE_URL not set");

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.end(); }
}

/** A café of its own per test, with one owner and a 100 g beef bowl that needs 60 g. */
async function cafe(name: string) {
  const business = randomUUID(), user = randomUUID(), membership = randomUUID();
  const beef = randomUUID(), item = randomUUID(), variant = randomUUID(), recipe = randomUUID();
  const email = `qa-${user}@test.local`;
  await query("insert into businesses (id,name,order_number_prefix) values ($1,$2,'QA')", [business, name]);
  await query("insert into users (id,name,email,password_hash) select $1,'QA Owner',$2,password_hash from users where email='owner@dev.local'", [user, email]);
  await query("insert into memberships (id,user_id,business_id) values ($1,$2,$3)", [membership, user, business]);
  await query("insert into membership_roles (membership_id,role_id) select $1,id from roles where name='owner'", [membership]);
  await query("insert into ingredients (id,business_id,name,base_unit,current_quantity_base_units,average_cost_per_base_unit) values ($1,$2,'QA Beef','gram',100,50)", [beef, business]);
  await query("insert into menu_items (id,business_id,name,base_price) values ($1,$2,'QA Beef Bowl',45000)", [item, business]);
  await query("insert into menu_item_variants (id,menu_item_id,name,price) values ($1,$2,'Regular',45000)", [variant, item]);
  await query("insert into recipes (id,business_id,menu_item_variant_id) values ($1,$2,$3)", [recipe, business, variant]);
  await query("insert into recipe_lines (id,business_id,recipe_id,ingredient_id,quantity_base_units) values (gen_random_uuid(),$1,$2,$3,60)", [business, recipe, beef]);
  return { business, user, beef, item, email };
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("a Matsudon expense form left open after switching to Konichiwa is refused, keeps its input, and works after refresh", async ({ page, context }) => {
  const matsudon = await cafe("QA Matsudon");
  const konichiwa = await cafe("QA Konichiwa");
  const payee = `Stale tab ${randomUUID().slice(0, 8)}`;

  await login(page, matsudon.email);
  // Granted after sign-in so the session starts in Matsudon.
  const membership = randomUUID();
  await query("insert into memberships (id,user_id,business_id) values ($1,$2,$3)", [membership, matsudon.user, konichiwa.business]);
  await query("insert into membership_roles (membership_id,role_id) select $1,id from roles where name='owner'", [membership]);
  await page.goto("/expenses");
  await expect(page.getByRole("img", { name: "QA Matsudon" })).toBeVisible();
  await page.getByRole("button", { name: "Record expense" }).click();
  const form = page.getByRole("dialog", { name: "Record expense" });
  await form.getByLabel("Amount (Rp)").fill("125000");
  await form.getByLabel("Payee / supplier").fill(payee);

  const other = await context.newPage();
  await other.goto("/dashboard");
  await other.getByRole("button", { name: /QA Owner/ }).click();
  await other.getByRole("group", { name: "Switch business" }).getByRole("menuitem", { name: /QA Konichiwa/ }).click();
  await expect(other.getByRole("img", { name: "QA Konichiwa" })).toBeVisible();

  await page.bringToFront();
  await form.getByRole("button", { name: "Record expense" }).click();
  await expect(form.getByRole("alert")).toContainText("changed in another tab");
  await expect(form.getByLabel("Amount (Rp)")).toHaveValue("125000");
  await expect(form.getByLabel("Payee / supplier")).toHaveValue(payee);
  expect(await query("select 1 from expenses where payee=$1", [payee])).toHaveLength(0);

  await page.reload();
  await page.getByRole("button", { name: "Record expense" }).click();
  await form.getByLabel("Amount (Rp)").fill("125000");
  await form.getByLabel("Payee / supplier").fill(payee);
  await form.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByText("Expense recorded.", { exact: true })).toBeVisible();
  const rows = await query<{ business_id: string }>("select business_id from expenses where payee=$1", [payee]);
  expect(rows).toEqual([{ business_id: konichiwa.business }]);
  await other.close();
});

test.describe("date defaults at 00:30 WIB", () => {
  // 28 Sep 00:30 in Jakarta is still 27 Sep in UTC.
  const justAfterMidnight = new Date("2026-09-27T17:30:00Z");

  test("a manual expense defaults to the Jakarta date and is saved on it", async ({ page }) => {
    const fx = await cafe("QA Dates");
    await login(page, fx.email);
    await page.clock.setFixedTime(justAfterMidnight);
    await page.goto("/expenses");
    await page.getByRole("button", { name: "Record expense" }).click();
    const form = page.getByRole("dialog", { name: "Record expense" });
    await expect(form.locator('input[name="expenseDate"]')).toHaveValue("2026-09-28");
    await form.getByLabel("Amount (Rp)").fill("40000");
    await form.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByText("Expense recorded.", { exact: true })).toBeVisible();
    const rows = await query<{ d: string }>("select to_char(expense_date,'YYYY-MM-DD') as d from expenses where business_id=$1", [fx.business]);
    expect(rows).toEqual([{ d: "2026-09-28" }]);
  });

  test("a new purchase receipt defaults both its dates to the Jakarta date", async ({ page }) => {
    const fx = await cafe("QA Dates");
    await login(page, fx.email);
    await page.clock.setFixedTime(justAfterMidnight);
    await page.goto("/purchases");
    await expect(page.locator("#purchaseDate")).toContainText("28 Sep 2026");
    await page.getByLabel("Supplier has been paid").check();
    await expect(page.locator("#paidAt")).toContainText("28 Sep 2026");
  });

  test("Mark paid defaults to the Jakarta date and records it", async ({ page }) => {
    const fx = await cafe("QA Dates");
    const purchase = randomUUID();
    await query("insert into purchases (id,business_id,purchase_date,status,total_cost,finalized_at) values ($1,$2,'2026-09-20','FINALIZED',60000,now())", [purchase, fx.business]);
    await login(page, fx.email);
    await page.clock.setFixedTime(justAfterMidnight);
    await page.goto(`/purchases/${purchase}`);
    await expect(page.locator("#purchase-paid-at")).toContainText("28 Sep 2026");
    await page.getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByText("Payment recorded.", { exact: true })).toBeVisible();
    const [row] = await query<{ paid: string; bought: string }>("select to_char(paid_at,'YYYY-MM-DD') as paid, to_char(purchase_date,'YYYY-MM-DD') as bought from purchases where id=$1", [purchase]);
    expect(row).toEqual({ paid: "2026-09-28", bought: "2026-09-20" });
  });

  test("during the day the defaults are unchanged", async ({ page }) => {
    const fx = await cafe("QA Dates");
    await login(page, fx.email);
    await page.clock.setFixedTime(new Date("2026-09-28T05:00:00Z")); // 12:00 WIB
    await page.goto("/expenses");
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.getByRole("dialog", { name: "Record expense" }).locator('input[name="expenseDate"]')).toHaveValue("2026-09-28");
  });
});

test("the POS explains a shortage the variant and its modifier only cause together", async ({ page }) => {
  const fx = await cafe("QA Stock");
  const group = randomUUID(), extra = randomUUID(), crumbs = randomUUID();
  await query("insert into modifier_groups (id,business_id,name,required,min_selections,max_selections) values ($1,$2,'Toppings',false,0,2)", [group, fx.business]);
  await query("insert into modifier_options (id,modifier_group_id,name,price_adjustment) values ($1,$3,'Extra beef',10000),($2,$3,'Beef crumbs',3000)", [extra, crumbs, group]);
  await query("insert into menu_item_modifier_groups (id,business_id,menu_item_id,modifier_group_id) values (gen_random_uuid(),$1,$2,$3)", [fx.business, fx.item, group]);
  await query("insert into modifier_recipe_lines (id,business_id,modifier_option_id,ingredient_id,quantity_base_units) values (gen_random_uuid(),$1,$2,$4,60),(gen_random_uuid(),$1,$3,$4,15)", [fx.business, extra, crumbs, fx.beef]);

  await login(page, fx.email);
  await page.goto("/pos");
  await page.getByRole("button", { name: /QA Beef Bowl/ }).click();
  const modal = page.getByRole("dialog", { name: "QA Beef Bowl" });
  const add = modal.getByRole("button", { name: /^Add/ });

  await expect(add).toBeEnabled(); // 60 g of 100 g
  await modal.getByRole("button", { name: /Extra beef/ }).click();
  await expect(modal.getByRole("alert")).toHaveText("Not enough QA Beef: needs 120 g, 100 g in stock (20 g short).");
  await expect(add).toBeDisabled();

  await modal.getByRole("button", { name: /Extra beef/ }).click();
  await modal.getByRole("button", { name: /Beef crumbs/ }).click();
  await expect(add).toBeEnabled(); // 75 g
  await modal.getByRole("button", { name: "Increase quantity" }).click();
  await expect(modal.getByRole("alert")).toContainText("needs 150 g");
  await expect(add).toBeDisabled();
  await modal.getByRole("button", { name: "Decrease quantity" }).click();
  await add.click();

  // One bowl with crumbs (75 g) is in the order; a plain bowl on top needs 135 g.
  await page.getByRole("button", { name: /QA Beef Bowl/ }).click();
  await expect(modal.getByRole("alert")).toContainText("needs 135 g");
  await expect(modal.getByRole("alert")).toContainText("already in this order");
  await modal.getByRole("button", { name: "Close item" }).click();

  // Stock drops after the POS loaded: the preview still allows it, checkout refuses it.
  await query("update ingredients set current_quantity_base_units = 10 where id=$1", [fx.beef]);
  await page.getByRole("button", { name: "Uang pas" }).click();
  await page.getByRole("button", { name: /Submit order/ }).click();
  await expect(page.getByRole("complementary", { name: "Current order" }).getByRole("alert")).toContainText("QA Beef");
  expect(await query("select 1 from orders where business_id=$1", [fx.business])).toHaveLength(0);
});
