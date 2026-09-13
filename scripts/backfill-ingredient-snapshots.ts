import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";

/**
 * One-off backfill for the `ingredient_name_snapshot` /
 * `ingredient_base_unit_snapshot` columns added so that deleting an
 * ingredient can't blank out the stock ledger, the COGS audit trail, or
 * past purchase/waste/stock-count records. Rows written before those
 * columns existed have NULL in them, so copy each row's ingredient as it
 * stands today — while those ingredients still exist.
 *
 * Run immediately after `npm run db:migrate`, and before deleting any
 * ingredient. Rows whose ingredient is already gone (ingredient_id IS
 * NULL) can't be recovered and are left alone.
 *
 * Idempotent: only fills rows that are still NULL.
 */
const TABLES = [
  "inventory_movements",
  "order_ingredient_consumption",
  "purchase_lines",
  "waste_records",
  "stock_count_lines",
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  for (const table of TABLES) {
    const result = await db.execute(sql`
      update ${sql.identifier(table)} t
      set ingredient_name_snapshot = i.name,
          ingredient_base_unit_snapshot = i.base_unit
      from ingredients i
      where t.ingredient_id = i.id
        and t.ingredient_name_snapshot is null
    `);
    console.log(`${table}: backfilled ${result.rowCount ?? 0} row(s).`);

    const orphans = await db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from ${sql.identifier(table)} t
      where t.ingredient_name_snapshot is null and t.ingredient_id is null
    `);
    const n = orphans.rows[0]?.n ?? 0;
    if (n > 0) console.log(`${table}: ${n} row(s) point at an already-deleted ingredient and stay NULL.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
