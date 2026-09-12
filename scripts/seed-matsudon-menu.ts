import "dotenv/config";
import { matsudonImageUrl } from "./matsudon-menu-images";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";

/**
 * One-off import of the real "Matsudon Menu" board (noodle / rice / snack)
 * into an existing business's menu. Unlike scripts/seed.ts, this is real
 * menu content, not fictional dev data — it does not create a business, it
 * attaches to one that already exists.
 *
 * Flavor choices printed on the board with no price difference (e.g. Mie
 * Goreng's Original/Kriuk/Rendang/Bangladesh/Ayam Geprek) become menu item
 * variants, all priced the same as the item's base price. The one add-on
 * with an actual price delta (Crispy Enoki: +Egg / +Chicken Karage, 7K
 * each) becomes a modifier group instead.
 *
 * Photos are cropped from the supplied Matsudon menu board. Existing
 * installations can attach missing photos with db:backfill:matsudon-images.
 *
 * Idempotent: skips entirely if a "Noodle", "Rice", or "Snack" category
 * already exists for the target business.
 *
 * Usage:
 *   npm run db:seed:matsudon-menu
 *   MENU_SEED_BUSINESS_ID=<uuid> npm run db:seed:matsudon-menu   # if more than one business exists
 */

type SeedItem = {
  name: string;
  price: number;
  description?: string;
  variants?: string[]; // same-price flavor choices; defaults to a single "Regular" variant
};

const NOODLE_ITEMS: SeedItem[] = [
  { name: "Mie Goreng Ulang Tahun", price: 27_000 },
  {
    name: "Mie Goreng",
    price: 15_000,
    variants: ["Original", "Kriuk", "Rendang", "Bangladesh", "Ayam Geprek"],
  },
  { name: "Mie Kuah", price: 16_000, variants: ["Kari Ayam", "Soto"] },
];

const RICE_ITEMS: SeedItem[] = [
  { name: "Spicy Tamago Curry Rice", price: 30_000, description: "New menu. Spicy." },
  { name: "Spicy Tori Curry Rice", price: 32_000, description: "New menu. Spicy." },
  { name: "Tamago Curry Rice", price: 28_000 },
  { name: "Tori Curry Rice", price: 30_000 },
  { name: "Gepurekkuchiri Karage Don", price: 30_000 },
  { name: "Teriyaki Karage Don", price: 28_000 },
];

const SNACK_ITEMS: SeedItem[] = [
  { name: "Crispy Enoki", price: 22_000, description: "Add Egg or Chicken Karage." },
  { name: "Taiyaki Coklat", price: 23_000 },
  { name: "Taiyaki Biscoff", price: 25_000 },
  { name: "Taiyaki Mix", price: 24_000 },
  {
    name: "French Fries",
    price: 21_000,
    variants: ["BBQ", "Keju", "Original", "Jagung Bakar"],
  },
];

const CATEGORIES: Array<{ name: string; displayOrder: number; items: SeedItem[] }> = [
  { name: "Noodle", displayOrder: 1, items: NOODLE_ITEMS },
  { name: "Rice", displayOrder: 2, items: RICE_ITEMS },
  { name: "Snack", displayOrder: 3, items: SNACK_ITEMS },
];

async function resolveBusinessId(db: ReturnType<typeof drizzle>): Promise<string> {
  const explicit = process.env.MENU_SEED_BUSINESS_ID;
  if (explicit) return explicit;

  const businesses = await db.select({ id: schema.businesses.id, name: schema.businesses.name }).from(schema.businesses);
  if (businesses.length === 0) {
    throw new Error("No business found. Run `npm run db:seed` first, or set MENU_SEED_BUSINESS_ID.");
  }
  if (businesses.length > 1) {
    const list = businesses.map((b) => `  - ${b.name} (${b.id})`).join("\n");
    throw new Error(`Multiple businesses found; set MENU_SEED_BUSINESS_ID to one of:\n${list}`);
  }
  return businesses[0].id;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const businessId = await resolveBusinessId(db);

  const existingCategories = await db
    .select({ name: schema.menuCategories.name })
    .from(schema.menuCategories)
    .where(eq(schema.menuCategories.businessId, businessId));
  const existingNames = new Set(existingCategories.map((c) => c.name));
  const alreadySeeded = CATEGORIES.every((c) => existingNames.has(c.name));
  if (alreadySeeded) {
    console.log(`Matsudon menu already present for business ${businessId}. Skipping.`);
    await pool.end();
    return;
  }

  console.log(`Seeding Matsudon menu into business ${businessId}...`);

  // A single modifier group covers the only priced add-on on the board.
  const [addOnGroup] = await db
    .insert(schema.modifierGroups)
    .values({ businessId, name: "Enoki Add-on", required: false, minSelections: 0, maxSelections: 2 })
    .returning();
  const addOnOptions = await db
    .insert(schema.modifierOptions)
    .values([
      { modifierGroupId: addOnGroup.id, name: "Egg", priceAdjustment: 7_000, displayOrder: 1 },
      { modifierGroupId: addOnGroup.id, name: "Chicken Karage", priceAdjustment: 7_000, displayOrder: 2 },
    ])
    .returning();
  console.log(`  Modifier group "Enoki Add-on": ${addOnOptions.map((o) => o.name).join(", ")}`);

  for (const category of CATEGORIES) {
    const [categoryRow] = await db
      .insert(schema.menuCategories)
      .values({ businessId, name: category.name, displayOrder: category.displayOrder })
      .returning();
    console.log(`Category: ${categoryRow.name}`);

    for (const [index, item] of category.items.entries()) {
      const [itemRow] = await db
        .insert(schema.menuItems)
        .values({
          businessId,
          categoryId: categoryRow.id,
          name: item.name,
          imageUrl: matsudonImageUrl(item.name),
          description: item.description ?? null,
          basePrice: item.price,
          tracksInventory: false, // no recipes for these yet — flip on once ingredients/recipes are set up
          displayOrder: index,
        })
        .returning();

      const flavorNames = item.variants ?? ["Regular"];
      await db.insert(schema.menuItemVariants).values(
        flavorNames.map((name, i) => ({
          menuItemId: itemRow.id,
          name,
          price: item.price,
          displayOrder: i,
        })),
      );

      if (item.name === "Crispy Enoki") {
        await db.insert(schema.menuItemModifierGroups).values({
          menuItemId: itemRow.id,
          modifierGroupId: addOnGroup.id,
          displayOrder: 0,
        });
      }

      console.log(`  ${itemRow.name} — Rp${item.price.toLocaleString("id-ID")} (${flavorNames.join(", ")})`);
    }
  }

  console.log("Done. Every item was seeded with its matched menu-board photo.");
  await pool.end();
}

main().catch((error) => {
  console.error("Matsudon menu seed failed:", error);
  process.exit(1);
});

