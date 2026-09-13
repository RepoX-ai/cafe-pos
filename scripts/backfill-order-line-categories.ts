import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";

/**
 * One-off backfill for `order_lines.category_name_snapshot`, added so that
 * deleting a menu item can never move its past revenue into
 * "Uncategorized" on the sales-by-category report. Lines written before
 * that column existed have NULL in it, which the report would read as
 * "Uncategorized" — so copy the category each line's menu item is in
 * today, while those items still exist.
 *
 * Run this immediately after `npm run db:migrate`, and before deleting any
 * menu item. Lines whose item was already deleted (menu_item_id IS NULL)
 * genuinely can't be recovered and are left alone.
 *
 * Idempotent: only touches rows that are still NULL and whose item has a
 * category, so it's safe to run more than once.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const counts = await db.execute<{ pending: number; unrecoverable: number }>(sql`
    select
      count(*) filter (where ol.category_name_snapshot is null and ol.menu_item_id is not null)::int as pending,
      count(*) filter (where ol.category_name_snapshot is null and ol.menu_item_id is null)::int as unrecoverable
    from order_lines ol
  `);
  const before = counts.rows[0];

  if (before.pending === 0) {
    console.log("No order lines need a category snapshot. Nothing to do.");
  } else {
    const result = await db.execute(sql`
      update order_lines ol
      set category_name_snapshot = mc.name
      from menu_items mi
      join menu_categories mc on mc.id = mi.category_id
      where ol.menu_item_id = mi.id
        and ol.category_name_snapshot is null
    `);
    console.log(`Backfilled ${result.rowCount ?? 0} order line(s) from their menu item's current category.`);
  }

  if (before.unrecoverable > 0) {
    console.log(
      `${before.unrecoverable} line(s) point at an already-deleted menu item and stay NULL — they report as "Uncategorized".`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
