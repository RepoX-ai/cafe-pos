import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";

/**
 * One-off backfill: menu_items created before createMenuItem started
 * auto-creating a default variant (see menu-service.ts) may still have zero
 * variants, which means they can never have a recipe — recipes are keyed
 * to menu_item_variant_id, not menu_item_id. This gives each of them a
 * "Regular" variant priced at the item's current basePrice, exactly like
 * createMenuItem does for new items.
 *
 * Idempotent: only touches items with zero variants, so it's safe to run
 * more than once (e.g. in a deploy step).
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const items = await db.select().from(schema.menuItems);
  const variants = await db.select({ menuItemId: schema.menuItemVariants.menuItemId }).from(schema.menuItemVariants);
  const itemIdsWithVariants = new Set(variants.map((v) => v.menuItemId));
  const orphaned = items.filter((item) => !itemIdsWithVariants.has(item.id));

  if (orphaned.length === 0) {
    console.log("No variant-less menu items found. Nothing to do.");
    await pool.end();
    return;
  }

  console.log(`Backfilling a default "Regular" variant for ${orphaned.length} menu item(s)...`);
  for (const item of orphaned) {
    const [variant] = await db
      .insert(schema.menuItemVariants)
      .values({ menuItemId: item.id, name: "Regular", price: item.basePrice })
      .returning();
    console.log(`  ${item.name} (${item.id}) -> variant ${variant.id} @ Rp${item.basePrice}`);
  }

  console.log("Done. Existing historical orders for these items are untouched (they still snapshot no variant).");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
