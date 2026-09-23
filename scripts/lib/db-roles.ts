import type { PoolClient } from "pg";

/**
 * Least-privilege runtime role for the app. Run as the schema owner (the
 * migration credentials) — idempotent, so it runs after every migration and
 * re-applies grants to any table a migration created.
 *
 * The runtime role can read and write rows and nothing else: no DDL, no
 * access to the migrations schema, no TRUNCATE, and no UPDATE/DELETE on the
 * append-only ledgers (inventory_movements, audit_logs). Foreign-key
 * ON DELETE SET NULL/CASCADE actions on those tables still work: PostgreSQL
 * runs referential actions with the table owner's privileges.
 */
const APPEND_ONLY_TABLES = ["inventory_movements", "audit_logs"];

export interface AppRoleOptions {
  role: string;
  password: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export async function ensureAppRole(client: PoolClient, { role, password }: AppRoleOptions): Promise<void> {
  if (!IDENTIFIER.test(role)) throw new Error(`APP_DB_ROLE "${role}" must be a lowercase SQL identifier.`);
  if (password.length < 16) throw new Error("APP_DB_PASSWORD must be at least 16 characters.");

  const { rows: me } = await client.query<{ owner: string; db: string; exists: boolean }>(
    `select current_user as owner, current_database() as db, exists(select 1 from pg_roles where rolname = $1) as exists`,
    [role],
  );
  const { owner, db, exists } = me[0];
  if (owner === role) throw new Error("Run the role setup with the migration (owner) credentials, not as the app role itself.");

  // format(%I/%L) quotes the identifier and the password literal server-side.
  const statement = exists
    ? "select format('alter role %I with login password %L nosuperuser nocreatedb nocreaterole noinherit', $1::text, $2::text) as sql"
    : "select format('create role %I with login password %L nosuperuser nocreatedb nocreaterole noinherit', $1::text, $2::text) as sql";
  const { rows } = await client.query<{ sql: string }>(statement, [role, password]);
  await client.query(rows[0].sql);

  const quoted = async (template: string, ...args: string[]) => {
    if (args.length === 0) {
      await client.query(template);
      return;
    }
    const { rows: out } = await client.query<{ sql: string }>(`select format($1, ${args.map((_, i) => `$${i + 2}::text`).join(", ")}) as sql`, [template, ...args]);
    await client.query(out[0].sql);
  };

  await quoted("grant connect on database %I to %I", db, role);
  await quoted("revoke create on schema public from public");
  await quoted("grant usage on schema public to %I", role);
  await quoted("grant select, insert, update, delete on all tables in schema public to %I", role);
  await quoted("grant usage, select on all sequences in schema public to %I", role);
  await quoted("revoke truncate, references, trigger on all tables in schema public from %I", role);
  for (const table of APPEND_ONLY_TABLES) {
    await quoted("revoke update, delete on table public.%I from %I", table, role);
  }
  // Tables created by future migrations (run as this owner) get row access automatically;
  // the append-only revokes above are re-applied on the next run.
  await quoted("alter default privileges for role %I in schema public grant select, insert, update, delete on tables to %I", owner, role);
  await quoted("alter default privileges for role %I in schema public grant usage, select on sequences to %I", owner, role);
  // The migrations bookkeeping schema is the owner's alone.
  await client.query(`select 1 from pg_namespace where nspname = 'drizzle'`).then(async (r) => {
    if (r.rowCount) await quoted("revoke all on schema drizzle from %I", role);
  });
}
