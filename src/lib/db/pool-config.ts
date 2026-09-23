import type { PoolConfig } from "pg";

/**
 * Connection-pool settings, validated. A typo in any of these must stop the
 * process at startup rather than quietly fall back to something else — a
 * pool of NaN connections, or no statement timeout, is not a safe default.
 *
 * Two pools per process:
 * - `app`: request/checkout traffic. Short timeouts; checkout holds
 *   ingredient row locks, so a stuck statement must fail fast.
 * - `reports`: dashboard reads, report screens and CSV exports. Small, so
 *   a burst of heavy reads queues here instead of taking the connections
 *   checkout needs; longer statement timeout for aggregates.
 *
 * Budget per app instance = DATABASE_POOL_MAX + DATABASE_REPORT_POOL_MAX
 * (default 5 + 2). See docs/deployment.md § Connection budget.
 */
export type PoolKind = "app" | "reports";

export class PoolConfigError extends Error {}

type Env = Record<string, string | undefined>;

function intSetting(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new PoolConfigError(`${name} must be a whole number (got "${raw}").`);
  const value = Number(raw);
  if (value < min || value > max) throw new PoolConfigError(`${name} must be between ${min} and ${max} (got ${value}).`);
  return value;
}

export interface ResolvedPoolSettings {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  /** Null when DATABASE_SESSION_TIMEOUTS=off (for a pooler that rejects startup parameters). */
  sessionTimeouts: { statement: number; lock: number; idleInTransaction: number } | null;
  applicationName: string;
}

export function resolvePoolSettings(kind: PoolKind, env: Env = process.env): ResolvedPoolSettings {
  const timeoutsMode = env.DATABASE_SESSION_TIMEOUTS?.trim().toLowerCase() || "on";
  if (timeoutsMode !== "on" && timeoutsMode !== "off") {
    throw new PoolConfigError(`DATABASE_SESSION_TIMEOUTS must be "on" or "off" (got "${env.DATABASE_SESSION_TIMEOUTS}").`);
  }
  const common = {
    connectionTimeoutMillis: intSetting(env, "DATABASE_CONNECT_TIMEOUT_MS", 10_000, 500, 120_000),
    idleTimeoutMillis: 30_000,
  };
  if (kind === "app") {
    return {
      ...common,
      max: intSetting(env, "DATABASE_POOL_MAX", 5, 1, 100),
      sessionTimeouts:
        timeoutsMode === "off"
          ? null
          : {
              statement: intSetting(env, "DATABASE_STATEMENT_TIMEOUT_MS", 15_000, 100, 600_000),
              lock: intSetting(env, "DATABASE_LOCK_TIMEOUT_MS", 5_000, 100, 600_000),
              idleInTransaction: intSetting(env, "DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS", 30_000, 1_000, 3_600_000),
            },
      applicationName: "cafe-pos",
    };
  }
  return {
    ...common,
    max: intSetting(env, "DATABASE_REPORT_POOL_MAX", 2, 1, 20),
    sessionTimeouts:
      timeoutsMode === "off"
        ? null
        : {
            statement: intSetting(env, "DATABASE_REPORT_STATEMENT_TIMEOUT_MS", 30_000, 100, 600_000),
            lock: intSetting(env, "DATABASE_LOCK_TIMEOUT_MS", 5_000, 100, 600_000),
            // An export holds its snapshot transaction open between batches
            // while the client reads; this is the ceiling on a stalled reader.
            idleInTransaction: intSetting(env, "DATABASE_REPORT_IDLE_IN_TRANSACTION_TIMEOUT_MS", 60_000, 1_000, 3_600_000),
          },
    applicationName: "cafe-pos-reports",
  };
}

export function toPgPoolConfig(connectionString: string, settings: ResolvedPoolSettings): PoolConfig {
  return {
    connectionString,
    max: settings.max,
    connectionTimeoutMillis: settings.connectionTimeoutMillis,
    idleTimeoutMillis: settings.idleTimeoutMillis,
    application_name: settings.applicationName,
    ...(settings.sessionTimeouts
      ? {
          statement_timeout: settings.sessionTimeouts.statement,
          lock_timeout: settings.sessionTimeouts.lock,
          idle_in_transaction_session_timeout: settings.sessionTimeouts.idleInTransaction,
        }
      : {}),
  };
}
