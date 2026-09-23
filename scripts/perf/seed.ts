import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { hashPassword } from "../../src/lib/auth/password";

/**
 * Seeds a *disposable* database with representative multi-tenant data for
 * query-plan evidence and `npm run test:perf`. Refuses to run unless the
 * target database name contains "perf" and NODE_ENV is not production.
 *
 *   PERF_BUSINESSES=5 PERF_DAYS=365 PERF_ORDERS_PER_DAY=250 \
 *     DATABASE_URL=postgres://.../cafe_pos_perf npm run perf:seed
 *
 * Also creates one owner login per café (perf-owner-<n>@perf.local) with the
 * password in PERF_PASSWORD (default "perf-only-password-1"), for browser runs.
 */
function intEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.includes("perf") || process.env.NODE_ENV === "production") {
    throw new Error(`Refusing to seed "${dbName}": the database name must contain "perf" and NODE_ENV must not be production.`);
  }

  const params = {
    businesses: intEnv("PERF_BUSINESSES", 5),
    days: intEnv("PERF_DAYS", 365),
    orders_per_day: intEnv("PERF_ORDERS_PER_DAY", 250),
  };
  const sqlText = readFileSync(path.join(__dirname, "seed-perf-data.sql"), "utf8").replace(
    /:(businesses|days|orders_per_day)\b/g,
    (_, key: keyof typeof params) => String(params[key]),
  );

  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  const started = Date.now();
  try {
    const { rows } = await client.query("select count(*)::int as n from businesses");
    if (rows[0].n > 0) throw new Error("Target database already has businesses; recreate it before seeding.");
    await client.query("set statement_timeout = 0");
    await client.query("begin");
    await client.query(sqlText);

    await client.query(`insert into roles (id, name) select gen_random_uuid(), r::role_name from unnest(array['super_admin','owner','manager','cashier','inventory_staff','viewer']) r on conflict do nothing`);
    const hash = await hashPassword(process.env.PERF_PASSWORD ?? "perf-only-password-1");
    await client.query(
      `with u as (
         insert into users (id, name, email, password_hash)
         select gen_random_uuid(), 'Perf Owner ' || b.order_number_prefix, 'perf-owner-' || substr(b.order_number_prefix, 2) || '@perf.local', $1
         from businesses b returning id, email
       ), m as (
         insert into memberships (id, user_id, business_id)
         select gen_random_uuid(), u.id, b.id from u join businesses b on 'perf-owner-' || substr(b.order_number_prefix, 2) || '@perf.local' = u.email
         returning id
       )
       insert into membership_roles (membership_id, role_id) select m.id, r.id from m, roles r where r.name = 'owner'`,
      [hash],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const counts = await pool.query(
    `select (select count(*) from businesses) as businesses, (select count(*) from orders) as orders,
            (select count(*) from order_lines) as order_lines, (select count(*) from order_line_modifiers) as modifiers,
            (select count(*) from inventory_movements) as movements, (select pg_size_pretty(pg_database_size(current_database()))) as size`,
  );
  console.log(`Seeded in ${Math.round((Date.now() - started) / 1000)}s`, counts.rows[0]);
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
