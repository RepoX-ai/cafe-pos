import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { deleteExpiredRateLimitBuckets } from "../src/server/services/rate-limit";

/**
 * Deletes expired rate-limit buckets in bounded batches. Safe to run at any
 * time and on any schedule (e.g. hourly cron on a VPS). Rate limiting stays
 * correct without it; the app also runs a throttled cleanup after requests.
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
  await pool.end();
}

main().catch((error) => {
  console.error("Rate-limit cleanup failed:", error);
  process.exit(1);
});
