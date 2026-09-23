import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { log } from "@/lib/observability/log";
import * as schema from "./schema";
import { resolvePoolSettings, toPgPoolConfig, type PoolKind } from "./pool-config";

declare global {
  var __cafePosPgPools: Partial<Record<PoolKind, Pool>> | undefined;
}

function thresholdMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Structured logs for the three things that make a small Postgres-backed
 * app slow under load: waiting for a pooled connection, slow statements,
 * and long transactions (which hold row locks — checkout's ingredient locks
 * in particular). Only statement text is logged, never parameters.
 */
function instrument(pool: Pool, kind: PoolKind) {
  const slowQueryMs = thresholdMs("SLOW_QUERY_MS", 500);
  const slowTransactionMs = thresholdMs("SLOW_TRANSACTION_MS", 1_000);
  const poolWaitMs = thresholdMs("POOL_WAIT_WARN_MS", 200);

  // Without a listener, an error on an idle client (database restart,
  // idle_in_transaction timeout, network drop) is an unhandled 'error'
  // event and takes the whole process down.
  pool.on("error", (error) => log("error", "db.idle_client_error", { pool: kind, errorName: error.name, pgCode: (error as { code?: string }).code }));

  const originalConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  const recordWait = (startedAt: number) => {
    const waited = performance.now() - startedAt;
    if (waited >= poolWaitMs) {
      log("warn", "db.pool_wait", { pool: kind, ms: Math.round(waited), waiting: pool.waitingCount, total: pool.totalCount, max: pool.options.max });
    }
  };
  (pool as { connect: unknown }).connect = (callback?: (error: Error | undefined, client?: PoolClient, done?: () => void) => void) => {
    const startedAt = performance.now();
    if (typeof callback === "function") {
      return originalConnect((error: Error | undefined, client?: PoolClient, done?: () => void) => {
        recordWait(startedAt);
        callback(error, client, done);
      });
    }
    return (originalConnect() as Promise<PoolClient>).then((client) => {
      recordWait(startedAt);
      return client;
    });
  };

  pool.on("connect", (client) => {
    const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
    let transactionStartedAt: number | null = null;
    (client as { query: unknown }).query = (...args: unknown[]) => {
      const first = args[0] as string | { text?: string } | undefined;
      const text = (typeof first === "string" ? first : first?.text ?? "").trim();
      const startedAt = performance.now();
      if (/^begin\b/i.test(text)) transactionStartedAt = startedAt;
      const finish = () => {
        const now = performance.now();
        if (now - startedAt >= slowQueryMs) {
          log("warn", "db.slow_query", { pool: kind, ms: Math.round(now - startedAt), sql: text.replace(/\s+/g, " ").slice(0, 300) });
        }
        if (transactionStartedAt !== null && /^(commit|rollback)\b/i.test(text)) {
          const held = now - transactionStartedAt;
          transactionStartedAt = null;
          if (held >= slowTransactionMs) log("warn", "db.slow_transaction", { pool: kind, ms: Math.round(held), outcome: text.split(/\s/)[0].toLowerCase() });
        }
      };
      const result = originalQuery(...args);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).then(finish, finish);
      }
      return result;
    };
  });
}

function createPool(kind: PoolKind): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  const pool = new Pool(toPgPoolConfig(connectionString, resolvePoolSettings(kind)));
  instrument(pool, kind);
  return pool;
}

/**
 * The pg pool of the given kind. Reused across Next.js dev hot-reloads so we
 * don't leak connections; in production this just runs once per process.
 */
export function getPool(kind: PoolKind): Pool {
  const pools = (globalThis.__cafePosPgPools ??= {});
  return (pools[kind] ??= createPool(kind));
}

function createDb(kind: PoolKind) {
  return drizzle(getPool(kind), { schema });
}

const instances: Partial<Record<PoolKind, ReturnType<typeof createDb>>> = {};

function getDb(kind: PoolKind) {
  return (instances[kind] ??= createDb(kind));
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
function lazyDb(kind: PoolKind) {
  return new Proxy({} as ReturnType<typeof createDb>, {
    get(_target, prop, receiver) {
      const real = getDb(kind);
      const value = Reflect.get(real, prop, receiver);
      return typeof value === "function" ? value.bind(real) : value;
    },
    has: (_target, prop) => Reflect.has(getDb(kind), prop),
    ownKeys: () => Reflect.ownKeys(getDb(kind)),
    getOwnPropertyDescriptor: (_target, prop) => {
      // The real descriptor may be non-configurable, which a Proxy may not
      // report for a property its (empty) target lacks — that throws a
      // TypeError. Reporting it configurable keeps the invariant satisfied.
      const descriptor = Reflect.getOwnPropertyDescriptor(getDb(kind), prop);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

/** Request and checkout traffic. */
export const db = lazyDb("app");

/**
 * Dashboard aggregates, report screens and CSV exports. A separate, small
 * pool: heavy reads queue here instead of taking checkout's connections.
 */
export const reportDb = lazyDb("reports");

/**
 * Accepts either the top-level db handle or a transaction (the callback
 * argument to `db.transaction(...)`), so service functions can be called
 * either standalone or composed inside a larger transaction without a
 * separate type for each.
 */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Database = typeof db | DbTransaction;
