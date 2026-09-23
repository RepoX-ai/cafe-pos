import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { log } from "@/lib/observability/log";

/**
 * Fixed-window rate limits shared by every app instance through PostgreSQL
 * (the `login_attempts` table holds all buckets). No Redis: one upsert per
 * bucket is atomic under concurrency and cheap at café traffic.
 */
export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

/** `RATE_LIMIT_*` env vars override a default with "<attempts>/<seconds>", e.g. "20/900". */
function envRule(name: string, envVar: string, limit: number, windowSeconds: number): RateLimitRule {
  const match = /^(\d+)\/(\d+)$/.exec(process.env[envVar]?.trim() ?? "");
  if (match && Number(match[1]) > 0 && Number(match[2]) > 0) {
    return { name, limit: Number(match[1]), windowSeconds: Number(match[2]) };
  }
  return { name, limit, windowSeconds };
}

/**
 * Defaults, all per 15 minutes for login and per window for authenticated actions:
 * - login per client IP (50/15m): stops identifier rotation from one address while
 *   leaving room for a whole café's staff behind one shared connection.
 * - login per account + IP (10/15m): the everyday typo allowance for one device.
 * - login per account (20/15m): caps guessing one account from many addresses;
 *   kept above the per-device limit so a lockout needs more than one source.
 * - checkout per user (60/1m): far above a cashier's pace; idempotent retries are exempt.
 * - print retry/reprint per user (20/1m) and CSV export per user (20/5m): costly, rare actions.
 * - order cancel/refund per user (30/1m): stock-restoring writes that should stay rare.
 * - staff writes per user (20/5m): create/reset/delete/(de)activate are infrequent and hash passwords.
 * - checkout retries per user (120/1m): replays of an idempotency key that already
 *   produced an order. Never refused — past the limit the order is still returned,
 *   only the extra print-job processing is skipped (see checkout.ts).
 * - stock-affecting back-office writes per user (60/1m): purchases, stock counts,
 *   adjustments, waste — each locks ingredient rows.
 * - catalog/admin writes per user (120/1m): menu, recipes, ingredients, suppliers,
 *   expenses, settings.
 * - image uploads per user (20/5m): each is up to 3MB decoded and written to storage.
 * - report page loads per user (120/1m): dashboard and report screens.
 * - business creation per user (5/1h) and business switching per user (30/1m).
 *
 * All of these are *request quotas*. Concurrent-work limits are separate:
 * the reports pool size, the export advisory-lock slots, and the in-process
 * bcrypt limiter (work-limiter.ts).
 *
 * Every authenticated key starts with the business id, so one café's burst
 * never uses up another café's allowance. Login buckets are necessarily
 * install-wide (there is no tenant before login).
 */
export const RATE_LIMITS = {
  loginClientIp: () => envRule("login-ip", "RATE_LIMIT_LOGIN_IP", 50, 900),
  loginAccountIp: () => envRule("login-account-ip", "RATE_LIMIT_LOGIN_ACCOUNT_IP", 10, 900),
  loginAccount: () => envRule("login-account", "RATE_LIMIT_LOGIN_ACCOUNT", 20, 900),
  checkout: () => envRule("checkout", "RATE_LIMIT_CHECKOUT", 60, 60),
  print: () => envRule("print", "RATE_LIMIT_PRINT", 20, 60),
  export: () => envRule("export", "RATE_LIMIT_EXPORT", 20, 300),
  orderMutation: () => envRule("order-mutation", "RATE_LIMIT_ORDER_MUTATION", 30, 60),
  staffWrite: () => envRule("staff-write", "RATE_LIMIT_STAFF_WRITE", 20, 300),
  checkoutRetry: () => envRule("checkout-retry", "RATE_LIMIT_CHECKOUT_RETRY", 120, 60),
  inventoryWrite: () => envRule("inventory-write", "RATE_LIMIT_INVENTORY_WRITE", 60, 60),
  catalogWrite: () => envRule("catalog-write", "RATE_LIMIT_CATALOG_WRITE", 120, 60),
  upload: () => envRule("upload", "RATE_LIMIT_UPLOAD", 20, 300),
  reportRead: () => envRule("report-read", "RATE_LIMIT_REPORT_READ", 120, 60),
  createBusiness: () => envRule("create-business", "RATE_LIMIT_CREATE_BUSINESS", 5, 3600),
  switchBusiness: () => envRule("switch-business", "RATE_LIMIT_SWITCH_BUSINESS", 30, 60),
};

/** Per-user bucket for an authenticated action, scoped to the user's current business. */
export function userBucket(rule: RateLimitRule, user: { businessId: string; id: string }): RateLimitCheck {
  return { rule, key: [user.businessId, user.id] };
}

/** `consumeRateLimit` for a signed-in user's action. */
export async function allowUserAction(db: Database, rule: RateLimitRule, user: { businessId: string; id: string }): Promise<boolean> {
  return consumeRateLimit(db, userBucket(rule, user));
}

export interface RateLimitCheck {
  rule: RateLimitRule;
  key: string[];
}

/** Stored bucket id: a hash, so raw emails and IPs are never persisted. */
export function bucketKey({ rule, key }: RateLimitCheck): string {
  return createHash("sha256").update(JSON.stringify([rule.name, ...key])).digest("hex");
}

/**
 * Atomically takes one attempt from a bucket. A full bucket inside its window
 * matches the upsert's WHERE clause as false: nothing is written and nothing
 * returned, so blocked attempts don't keep rewriting the row.
 */
export async function consumeRateLimit(db: Database, check: RateLimitCheck): Promise<boolean> {
  const { rule } = check;
  const result = await db.execute(sql`
    insert into login_attempts as bucket (key_hash, count, window_start, expires_at)
    values (${bucketKey(check)}, 1, now(), now() + make_interval(secs => ${rule.windowSeconds}::double precision))
    on conflict (key_hash) do update set
      count = case when bucket.expires_at <= now() then 1 else bucket.count + 1 end,
      window_start = case when bucket.expires_at <= now() then now() else bucket.window_start end,
      expires_at = case
        when bucket.expires_at <= now() then now() + make_interval(secs => ${rule.windowSeconds}::double precision)
        else bucket.expires_at
      end
    where bucket.expires_at <= now() or bucket.count < ${rule.limit}::int
    returning count
  `);
  const allowed = result.rows.length > 0;
  // Bucket keys are hashed and may contain an email or IP, so only the rule
  // (and the business, for authenticated buckets) is logged.
  if (!allowed) log("warn", "rate_limit.blocked", { rule: rule.name, businessId: businessIdOf(check) });
  return allowed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function businessIdOf(check: RateLimitCheck): string | undefined {
  return check.key[0] && UUID.test(check.key[0]) ? check.key[0] : undefined;
}

/** Checks buckets in order and stops at the first full one, returning its rule (or null if all allowed). */
export async function consumeRateLimits(db: Database, checks: RateLimitCheck[]): Promise<RateLimitRule | null> {
  for (const check of checks) {
    if (!(await consumeRateLimit(db, check))) return check.rule;
  }
  return null;
}

export async function clearRateLimits(db: Database, checks: RateLimitCheck[]) {
  if (checks.length === 0) return;
  await db.execute(
    sql`delete from login_attempts where key_hash in (${sql.join(checks.map((check) => sql`${bucketKey(check)}`), sql`, `)})`,
  );
}

/** Deletes up to `batchSize` expired buckets. Correctness never depends on this — it only bounds table size. */
export async function deleteExpiredRateLimitBuckets(db: Database, batchSize = 1000): Promise<number> {
  const result = await db.execute(sql`
    delete from login_attempts
    where key_hash in (select key_hash from login_attempts where expires_at < now() limit ${batchSize})
  `);
  return result.rowCount ?? 0;
}

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanupAt = 0;

/**
 * True at most once per interval per process. Request handlers use it to run
 * `deleteExpiredRateLimitBuckets` inside `after()` — off the response path —
 * which works the same on Vercel and a long-running Node server. A cron job
 * can run `npm run db:cleanup-rate-limits` instead or as well.
 */
export function claimRateLimitCleanupSlot(now = Date.now()): boolean {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return false;
  lastCleanupAt = now;
  return true;
}
