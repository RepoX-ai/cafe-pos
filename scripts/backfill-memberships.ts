import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";

/**
 * One-off data migration for multi-tenancy.
 *
 * Access used to live on the user row (`users.business_id`) — one login,
 * one cafe, forever. It now lives on `memberships`, so one person can hold
 * several cafes. This script moves the existing data across and fills the
 * denormalised `business_id` columns added to the four tables that
 * previously only reached their tenant through a join.
 *
 * Run order matters:
 *
 *   1. npm run db:migrate                  (applies 0010, additive only)
 *   2. npm run db:backfill-memberships     (this script)
 *   3. npm run db:migrate                  (applies 0011, drops the old
 *                                           columns and adds NOT NULL)
 *
 * Step 3 fails loudly rather than silently discarding anything if step 2
 * was skipped — the NOT NULL constraints have nothing to bite on.
 *
 * Idempotent: every statement either skips conflicts or only touches rows
 * that are still NULL, so a re-run is safe.
 *
 * Sessions are deliberately deleted rather than mapped. Everyone signs in
 * again once, which costs a café one morning's inconvenience and removes
 * any chance of a half-migrated session resolving to the wrong business.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    await db.transaction(async (tx) => {
      // 1. One membership per existing user, carrying their business.
      const memberships = await tx.execute(sql`
        insert into memberships (id, user_id, business_id, active, last_used_at, created_at, updated_at)
        select gen_random_uuid(), u.id, u.business_id, true, now(), u.created_at, now()
        from users u
        on conflict (user_id, business_id) do nothing
      `);
      console.log(`memberships created: ${memberships.rowCount ?? 0}`);

      // 2. Roles move from the user to that membership.
      const roles = await tx.execute(sql`
        insert into membership_roles (membership_id, role_id)
        select m.id, ur.role_id
        from user_roles ur
        join memberships m on m.user_id = ur.user_id
        on conflict (membership_id, role_id) do nothing
      `);
      console.log(`membership roles created: ${roles.rowCount ?? 0}`);

      // 3. Denormalised tenant columns. Each derives from the join the
      //    application used to perform on every single read.
      const recipes = await tx.execute(sql`
        update recipes r
        set business_id = mi.business_id
        from menu_item_variants v
        join menu_items mi on mi.id = v.menu_item_id
        where v.id = r.menu_item_variant_id and r.business_id is null
      `);
      console.log(`recipes scoped: ${recipes.rowCount ?? 0}`);

      const recipeLines = await tx.execute(sql`
        update recipe_lines rl
        set business_id = r.business_id
        from recipes r
        where r.id = rl.recipe_id and rl.business_id is null
      `);
      console.log(`recipe lines scoped: ${recipeLines.rowCount ?? 0}`);

      const modifierLines = await tx.execute(sql`
        update modifier_recipe_lines ml
        set business_id = mg.business_id
        from modifier_options mo
        join modifier_groups mg on mg.id = mo.modifier_group_id
        where mo.id = ml.modifier_option_id and ml.business_id is null
      `);
      console.log(`modifier recipe lines scoped: ${modifierLines.rowCount ?? 0}`);

      const printJobs = await tx.execute(sql`
        update print_jobs pj
        set business_id = o.business_id
        from orders o
        where o.id = pj.order_id and pj.business_id is null
      `);
      console.log(`print jobs scoped: ${printJobs.rowCount ?? 0}`);

      // 4. Force a fresh sign-in; see the note at the top.
      const sessions = await tx.execute(sql`delete from sessions`);
      console.log(`sessions cleared (everyone signs in again): ${sessions.rowCount ?? 0}`);
    });

    console.log("\nBackfill complete. Now run `npm run db:migrate` again to apply 0011.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
