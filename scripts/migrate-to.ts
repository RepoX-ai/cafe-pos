import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Applies pending migrations up to and including one tag, then stops.
 *
 * `npm run db:migrate` runs every pending migration inside a single
 * transaction, which is the right default — a half-applied schema is
 * worse than none. But it makes a migration that needs a *data* step in
 * the middle impossible to reach on an install that is several
 * migrations behind: the later migration fails, and the rollback takes
 * the earlier ones with it.
 *
 * That is exactly the memberships upgrade (0010, backfill, 0011), so:
 *
 *   npm run db:migrate-to 0010_add_memberships_and_tenant_columns
 *   npm run db:backfill-memberships
 *   npm run db:migrate
 *
 * Bookkeeping is byte-identical to drizzle's own migrator — `hash` is the
 * sha256 of the migration file, `created_at` is the journal's `when` — so
 * `db:migrate` afterwards picks up exactly where this left off and never
 * re-applies anything.
 *
 * Each migration still runs in its own transaction: a failure leaves the
 * ones before it applied and recorded, and nothing half-written.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle", "migrations");

interface JournalEntry {
  tag: string;
  when: number;
}

function loadJournal(): JournalEntry[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
  return journal.entries as JournalEntry[];
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const target = process.argv[2];
  if (!target) {
    throw new Error(
      "Usage: npm run db:migrate-to <migration-tag>\n" +
        "e.g.   npm run db:migrate-to 0010_add_memberships_and_tenant_columns",
    );
  }

  const entries = loadJournal();
  const targetIndex = entries.findIndex((entry) => entry.tag === target);
  if (targetIndex === -1) {
    throw new Error(`No migration named "${target}". Known tags:\n  ${entries.map((e) => e.tag).join("\n  ")}`);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Same bootstrap drizzle's migrator performs, so this works on a
    // database that has never been migrated.
    await client.query(`create schema if not exists "drizzle"`);
    await client.query(`
      create table if not exists "drizzle"."__drizzle_migrations" (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `);

    // Drizzle decides what is pending by timestamp, not by hash: it takes
    // the newest recorded `created_at` and applies every journal entry
    // whose `when` is greater. Matching that exactly is what keeps this
    // script and `db:migrate` interchangeable — a hash comparison would
    // re-run migrations whose file was edited after being applied.
    const { rows } = await client.query<{ created_at: string | null }>(
      `select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1`,
    );
    const lastApplied = rows[0]?.created_at ? Number(rows[0].created_at) : 0;

    let count = 0;
    for (const entry of entries.slice(0, targetIndex + 1)) {
      if (entry.when <= lastApplied) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");

      await client.query("begin");
      try {
        for (const statement of sql.split("--> statement-breakpoint")) {
          const trimmed = statement.trim();
          if (trimmed) await client.query(trimmed);
        }
        await client.query(`insert into "drizzle"."__drizzle_migrations" (hash, created_at) values ($1, $2)`, [
          hash,
          entry.when,
        ]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${entry.tag} failed: ${(error as Error).message}`);
      }
      console.log(`applied ${entry.tag}`);
      count += 1;
    }

    console.log(count === 0 ? `Already at or past ${target}; nothing to do.` : `Stopped at ${target} (${count} applied).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
