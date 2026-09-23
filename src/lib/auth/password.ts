import bcrypt from "bcryptjs";
import { createWorkLimiter, positiveIntFromEnv, type WorkLimiter } from "@/lib/work-limiter";

const SALT_ROUNDS = 12;

/**
 * bcryptjs is pure JavaScript: one cost-12 hash or compare is roughly a
 * quarter-second of this process's CPU. Without a bound, a burst of logins
 * (or staff resets) queues that work on the same event loop that serves
 * checkout. At most BCRYPT_MAX_CONCURRENT run at once and BCRYPT_MAX_QUEUE
 * wait; beyond that the request is refused as "busy".
 */
let limiter: WorkLimiter | undefined;
function bcryptLimiter(): WorkLimiter {
  return (limiter ??= createWorkLimiter("bcrypt", positiveIntFromEnv("BCRYPT_MAX_CONCURRENT", 2), positiveIntFromEnv("BCRYPT_MAX_QUEUE", 32)));
}

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return bcryptLimiter().run(() => bcrypt.hash(plainTextPassword, SALT_ROUNDS));
}

export async function verifyPassword(plainTextPassword: string, hash: string): Promise<boolean> {
  return bcryptLimiter().run(() => bcrypt.compare(plainTextPassword, hash));
}
