import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { deleteExpiredSessions } from "../src/lib/auth/session";
import { deleteExpiredRateLimitBuckets } from "../src/server/services/rate-limit";
import { deleteExpiredIdempotencyKeys } from "../src/server/services/request-idempotency";

/**
 * Deletes expired rate-limit buckets, expired sessions and idempotency keys
 * older than 7 days in bounded
 * batches. Safe to run at any time and on any schedule (e.g. hourly cron on
 * a VPS). Neither rate limiting nor auth depends on it for correctness; the
 * app also runs the same throttled cleanup after login requests.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  let total = 0;
  for (;;) {
    const deleted = await deleteExpiredRateLimitBuckets(db as never, 1000);
    total += deleted;
    if (deleted < 1000) break;
  }
  console.log(`Deleted ${total} expired rate-limit bucket(s).`);
  let sessionsDeleted = 0;
  for (;;) {
    const deleted = await deleteExpiredSessions(db as never, 1000);
    sessionsDeleted += deleted;
    if (deleted < 1000) break;
  }
  console.log(`Deleted ${sessionsDeleted} expired session(s).`);
  let keysDeleted = 0;
  for (;;) {
    const deleted = await deleteExpiredIdempotencyKeys(db as never, 7, 1000);
    keysDeleted += deleted;
    if (deleted < 1000) break;
  }
  console.log(`Deleted ${keysDeleted} idempotency key(s) older than 7 days.`);
  await pool.end();
}

main().catch((error) => {
  console.error("Rate-limit cleanup failed:", error);
  process.exit(1);
});
