import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { loginAttempts } from "@/lib/db/schema";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");
/** Atomic reservation shared across Vercel workers and VPS processes. */
export async function consumeLoginAttempt(db: Database, key: string): Promise<boolean> {
  await db.delete(loginAttempts).where(sql`${loginAttempts.windowStart} < now() - interval '15 minutes'`);
  const rows = await db.insert(loginAttempts).values({ keyHash: hash(key), count: 1 })
    .onConflictDoUpdate({ target: loginAttempts.keyHash, set: { count: sql`${loginAttempts.count} + 1` },
      setWhere: sql`${loginAttempts.count} < 10` }).returning({ key: loginAttempts.keyHash });
  return rows.length > 0;
}
export async function clearLoginAttempts(db: Database, key: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.keyHash, hash(key)));
}
