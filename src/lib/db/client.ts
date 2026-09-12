import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __cafePosPgPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  return new Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
}

// Reuse the pool across Next.js dev hot-reloads so we don't leak
// connections; in production this just runs once per process.
const pool = globalThis.__cafePosPgPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalThis.__cafePosPgPool = pool;
}

export const db = drizzle(pool, { schema });

/**
 * Accepts either the top-level db handle or a transaction (the callback
 * argument to `db.transaction(...)`), so service functions can be called
 * either standalone or composed inside a larger transaction without a
 * separate type for each.
 */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Database = typeof db | DbTransaction;

