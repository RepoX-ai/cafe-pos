import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { DEV_SEED_ACCOUNTS, DEV_SEED_PASSWORD } from "../src/lib/dev-seed-accounts";

/**
 * Development seed data (PRD §16). Everything here is clearly fictional —
 * do not point this at a production database.
 */

const DEV_BUSINESS_NAME = "Fictional Coffee Co. (Dev Seed)";

async function main() {
  // This creates real, functioning accounts behind a password that is
  // public in this repo's history (DEV_SEED_PASSWORD) — running it
  // against anything but a throwaway local/dev database would hand out a
  // known login. Same guard as the dev quick-login server action.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the dev seed script with NODE_ENV=production.");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const [existing] = await db
    .select({ id: schema.businesses.id })
    .from(schema.businesses)
    .where(eq(schema.businesses.name, DEV_BUSINESS_NAME))
    .limit(1);

  if (existing) {
    console.log(`Seed data already present (business ${existing.id}). Skipping.`);
    await pool.end();
    return;
  }

  console.log("Seeding development data...");

  // --- Business & location -------------------------------------------------
  const [business] = await db
    .insert(schema.businesses)
    .values({
      name: DEV_BUSINESS_NAME,
      currency: "IDR",
      timezone: "Asia/Jakarta",
      orderNumberPrefix: "DEV",
      receiptFooter: "Thank you — this is development seed data.",
    })
    .returning();

  const [location] = await db
    .insert(schema.locations)
    .values({ businessId: business.id, name: "Main Store" })
    .returning();

  // --- Roles (global catalog, idempotent) -----------------------------------
  const roleNames = [
    "super_admin",
    "owner",
    "manager",
    "cashier",
    "inventory_staff",
    "viewer",
  ] as const;

  const roleRows = await db
    .insert(schema.roles)
    .values(roleNames.map((name) => ({ name })))
    .onConflictDoNothing({ target: schema.roles.name })
    .returning();

  const allRoles =
    roleRows.length === roleNames.length
      ? roleRows
      : await db.select().from(schema.roles);
  const roleIdByName = new Map(allRoles.map((r) => [r.name, r.id]));

  // --- Staff users, one per role, for exercising the permission matrix ------
  const passwordHash = await hashPassword(DEV_SEED_PASSWORD);

  for (const person of DEV_SEED_ACCOUNTS) {
    const [user] = await db
      .insert(schema.users)
      .values({
        name: person.name,
        email: person.email,
        passwordHash,
      })
      .returning();

    const [membership] = await db
      .insert(schema.memberships)
      .values({ userId: user.id, businessId: business.id })
      .returning();

    const roleId = roleIdByName.get(person.role);
    if (!roleId) throw new Error(`Missing role: ${person.role}`);
    await db.insert(schema.membershipRoles).values({ membershipId: membership.id, roleId });
  }

  // --- Ingredients (base units per PRD §1.7) --------------------------------
  type SeedIngredient = {
    name: string;
    baseUnit: "gram" | "millilitre" | "piece";
    openingQuantity: string;
    costPerBaseUnit: string; // Rupiah per base unit, exact decimal
  };

  const seedIngredients: SeedIngredient[] = [
    { name: "Coffee beans", baseUnit: "gram", openingQuantity: "5000", costPerBaseUnit: "0.25" },
    { name: "Fresh milk", baseUnit: "millilitre", openingQuantity: "10000", costPerBaseUnit: "0.02" },
    { name: "Syrup", baseUnit: "millilitre", openingQuantity: "3000", costPerBaseUnit: "0.08" },
    { name: "Ice", baseUnit: "gram", openingQuantity: "20000", costPerBaseUnit: "0.005" },
    { name: "Paper cup", baseUnit: "piece", openingQuantity: "500", costPerBaseUnit: "500" },
    { name: "Cup lid", baseUnit: "piece", openingQuantity: "500", costPerBaseUnit: "200" },
  ];

  const ingredientIdByName = new Map<string, string>();
  for (const ing of seedIngredients) {
    const [row] = await db
      .insert(schema.ingredients)
      .values({
        businessId: business.id,
        name: ing.name,
        baseUnit: ing.baseUnit,
        currentQuantityBaseUnits: ing.openingQuantity,
        averageCostPerBaseUnit: ing.costPerBaseUnit,
        reorderLevelBaseUnits: "500",
      })
      .returning();
    ingredientIdByName.set(ing.name, row.id);

    // Record the opening balance in the ledger — never set a quantity
    // silently (PRD §1.3).
    await db.insert(schema.inventoryMovements).values({
      businessId: business.id,
      locationId: location.id,
      ingredientId: row.id,
      movementType: "OPENING_BALANCE",
      quantityBaseUnits: ing.openingQuantity,
      unitCost: ing.costPerBaseUnit,
      sourceType: "seed_script",
      reason: "Development seed opening balance",
    });
  }

  // --- Menu category ---------------------------------------------------------
  const [coffeeCategory] = await db
    .insert(schema.menuCategories)
    .values({ businessId: business.id, name: "Coffee", displayOrder: 1 })
    .returning();

  // --- Menu items, variants, and recipes --------------------------------------
  type SeedMenuItem = {
    name: string;
    price: number;
    recipe: Array<{ ingredient: string; quantity: string }>;
  };

  const seedMenuItems: SeedMenuItem[] = [
    {
      name: "Coffee A",
      price: 25_000,
      recipe: [
        { ingredient: "Coffee beans", quantity: "18" },
        { ingredient: "Fresh milk", quantity: "150" },
        { ingredient: "Syrup", quantity: "10" },
        { ingredient: "Paper cup", quantity: "1" },
        { ingredient: "Cup lid", quantity: "1" },
      ],
    },
    {
      name: "Coffee B",
      price: 30_000,
      recipe: [
        { ingredient: "Coffee beans", quantity: "20" },
        { ingredient: "Fresh milk", quantity: "180" },
        { ingredient: "Syrup", quantity: "15" },
        { ingredient: "Paper cup", quantity: "1" },
        { ingredient: "Cup lid", quantity: "1" },
      ],
    },
  ];

  for (const item of seedMenuItems) {
    const [menuItem] = await db
      .insert(schema.menuItems)
      .values({
        businessId: business.id,
        categoryId: coffeeCategory.id,
        name: item.name,
        basePrice: item.price,
        tracksInventory: true,
      })
      .returning();

    const [variant] = await db
      .insert(schema.menuItemVariants)
      .values({ menuItemId: menuItem.id, name: "Regular", price: item.price })
      .returning();

    const [recipe] = await db
      .insert(schema.recipes)
      .values({ businessId: business.id, menuItemVariantId: variant.id, version: 1 })
      .returning();

    await db.insert(schema.recipeLines).values(
      item.recipe.map((line) => {
        const ingredientId = ingredientIdByName.get(line.ingredient);
        if (!ingredientId) throw new Error(`Unknown seed ingredient: ${line.ingredient}`);
        return {
          businessId: business.id,
          recipeId: recipe.id,
          ingredientId,
          quantityBaseUnits: line.quantity,
        };
      }),
    );
  }

  console.log("Seed complete.");
  console.log(`Business: ${business.name} (${business.id})`);
  console.log("Login with any of the following (password: %s):", DEV_SEED_PASSWORD);
  for (const person of DEV_SEED_ACCOUNTS) {
    console.log(`  - ${person.email}  [${person.role}]`);
  }

  await pool.end();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
