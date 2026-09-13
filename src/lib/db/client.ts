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

function createDb() {
  // Reuse the pool across Next.js dev hot-reloads so we don't leak
  // connections; in production this just runs once per process.
  const pool = globalThis.__cafePosPgPool ?? createPool();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__cafePosPgPool = pool;
  }
  return drizzle(pool, { schema });
}

let instance: ReturnType<typeof createDb> | undefined;

function getDb() {
  return (instance ??= createDb());
}

/**
 * Lazy on purpose. `next build` evaluates every route's module graph to
 * collect page data, which reaches this file even for routes that never
 * query (e.g. /_not-found via the root layout). Connecting — or throwing
 * on a missing DATABASE_URL — at import time would make the build itself
 * require a configured database, which broke deploys on hosts where env
 * vars are only present at runtime. The pool is now created on the first
 * actual query instead.
 */
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
  has: (_target, prop) => Reflect.has(getDb(), prop),
  ownKeys: () => Reflect.ownKeys(getDb()),
  getOwnPropertyDescriptor: (_target, prop) => {
    // The real descriptor may be non-configurable, which a Proxy may not
    // report for a property its (empty) target lacks — that throws a
    // TypeError. Reporting it configurable keeps the invariant satisfied.
    const descriptor = Reflect.getOwnPropertyDescriptor(getDb(), prop);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

/**
 * Accepts either the top-level db handle or a transaction (the callback
 * argument to `db.transaction(...)`), so service functions can be called
 * either standalone or composed inside a larger transaction without a
 * separate type for each.
 */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Database = typeof db | DbTransaction;
