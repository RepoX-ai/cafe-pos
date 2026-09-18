import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

export function getTestDb() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) return null;
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

export type TestDb = NonNullable<ReturnType<typeof getTestDb>>;

/**
 * Creates an isolated business + owner user + owner membership + one
 * ingredient + one menu item/variant/recipe for a single test to
 * exercise. Each test gets its own business row (named uniquely) so tests
 * never see each other's data, even though they share one physical test
 * database.
 */
export async function seedTestFixture(db: TestDb, opts: { openingStock?: string; costPerBaseUnit?: string } = {}) {
  const suffix = randomUUID().slice(0, 8);

  const [business] = await db
    .insert(schema.businesses)
    .values({ name: `Test Café ${suffix}`, orderNumberPrefix: "TST" })
    .returning();

  const [user] = await db
    .insert(schema.users)
    .values({
      name: "Test Owner",
      email: `owner-${suffix}@test.local`,
      passwordHash: await hashPassword("irrelevant"),
    })
    .returning();

  const [membership] = await db
    .insert(schema.memberships)
    .values({ userId: user.id, businessId: business.id })
    .returning();

  const [ingredient] = await db
    .insert(schema.ingredients)
    .values({
      businessId: business.id,
      name: `Test Bean ${suffix}`,
      baseUnit: "gram",
      currentQuantityBaseUnits: opts.openingStock ?? "1000",
      averageCostPerBaseUnit: opts.costPerBaseUnit ?? "1",
    })
    .returning();

  const [menuItem] = await db
    .insert(schema.menuItems)
    .values({ businessId: business.id, name: `Test Coffee ${suffix}`, basePrice: 20_000 })
    .returning();

  const [variant] = await db
    .insert(schema.menuItemVariants)
    .values({ menuItemId: menuItem.id, name: "Regular", price: 20_000 })
    .returning();

  const [recipe] = await db
    .insert(schema.recipes)
    .values({ businessId: business.id, menuItemVariantId: variant.id })
    .returning();

  await db.insert(schema.recipeLines).values({
    businessId: business.id,
    recipeId: recipe.id,
    ingredientId: ingredient.id,
    quantityBaseUnits: "20",
  });

  return { business, user, membership, ingredient, menuItem, variant };
}
