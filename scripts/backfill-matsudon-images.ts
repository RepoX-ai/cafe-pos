import "dotenv/config";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { matsudonImageUrl, matsudonMenuImages } from "./matsudon-menu-images";

/** Preview by default; --apply fills missing images for one business only. */
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) throw new Error("Only --apply is supported.");
  const apply = args.includes("--apply");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  for (const item of matsudonMenuImages) {
    await access(resolve("public/images/menu/matsudon", item.file));
  }

  const pool = new Pool({ connectionString });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const explicit = process.env.MENU_SEED_BUSINESS_ID;
      const businesses = explicit
        ? await client.query<{ id: string; name: string }>("SELECT id, name FROM businesses WHERE id = $1", [explicit])
        : await client.query<{ id: string; name: string }>("SELECT id, name FROM businesses");
      if (businesses.rows.length !== 1) {
        throw new Error("Expected one business. Set MENU_SEED_BUSINESS_ID to an existing business UUID.");
      }
      const business = businesses.rows[0];
      console.log(`${apply ? "Applying" : "Previewing"} Matsudon photos for ${business.name} (${business.id})`);
      let updated = 0;
      for (const item of matsudonMenuImages) {
        const result = await client.query<{ id: string; image_url: string | null }>(
          `SELECT m.id, m.image_url FROM menu_items m
           JOIN menu_categories c ON c.id = m.category_id AND c.business_id = m.business_id
           WHERE m.business_id = $1 AND m.name = $2 AND c.name = $3
           FOR UPDATE OF m`,
          [business.id, item.name, item.category],
        );
        if (result.rows.length > 1) throw new Error(`Ambiguous duplicate menu item: ${item.name}. No changes committed.`);
        const row = result.rows[0];
        if (!row) {
          console.log(`Missing: ${item.name}`);
          continue;
        }
        if (row.image_url?.trim()) {
          console.log(`Keeping existing image: ${item.name}`);
          continue;
        }
        const imageUrl = matsudonImageUrl(item.name);
        if (apply) {
          await client.query(
            "UPDATE menu_items SET image_url = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3",
            [imageUrl, row.id, business.id],
          );
        }
        updated++;
        console.log(`${apply ? "Attached" : "Would attach"}: ${item.name} -> ${imageUrl}`);
      }
      await client.query(apply ? "COMMIT" : "ROLLBACK");
      console.log(`${updated} image(s) ${apply ? "attached" : "eligible; rerun with --apply to save"}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Matsudon image backfill failed:", error);
  process.exitCode = 1;
});
