import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { ensureAppRole } from "./lib/db-roles";

/**
 * Applies migrations with the *owner* credentials — MIGRATION_DATABASE_URL,
 * or DATABASE_URL for single-role setups (local dev, older installs).
 *
 * With APP_DB_ROLE and APP_DB_PASSWORD set it then creates/updates the
 * least-privilege runtime role and re-applies its grants (see
 * scripts/lib/db-roles.ts). The running app should use that role; only this
 * script needs the owner's password.
 */
async function main() {
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("MIGRATION_DATABASE_URL (or DATABASE_URL) is not set.");
  }

  // Migrations can legitimately run longer than the app's statement timeout.
  const pool = new Pool({ connectionString, max: 1, application_name: "cafe-pos-migrate" });
  const db = drizzle(pool);

  console.log("Running migrations from ./drizzle/migrations ...");
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  console.log("Migrations complete.");

  const role = process.env.APP_DB_ROLE?.trim();
  if (role) {
    const password = process.env.APP_DB_PASSWORD ?? "";
    const client = await pool.connect();
    try {
      await client.query("begin");
      await ensureAppRole(client, { role, password });
      await client.query("commit");
      console.log(`Runtime role "${role}" and its grants are up to date.`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((error) => {
  // The PostgreSQL error (message, detail, hint — e.g. the integrity
  // preflight's list of offending rows), never the connection string or
  // role password. Drizzle's own message is the failed SQL text.
  let root: { message?: string; detail?: string; hint?: string; cause?: unknown } = error;
  while (root?.cause) root = root.cause as typeof root;
  console.error("Migration failed:", root?.message ?? error);
  if (root?.detail) console.error("Detail:", root.detail);
  if (root?.hint) console.error("Hint:", root.hint);
  process.exit(1);
});
