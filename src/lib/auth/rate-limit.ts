/**
 * In-memory sliding-window rate limiter for login attempts (PRD §12:
 * "Rate-limit login and sensitive mutation endpoints").
 *
 * This is intentionally simple and process-local — correct for the
 * single-VPS/single-instance deployment this MVP targets, but it does
 * NOT share state across multiple app instances (e.g. several Vercel
 * function invocations, or a multi-replica VPS setup). If this ever runs
 * behind more than one instance, replace the Map below with a shared
 * store (Postgres table or Redis) keyed the same way — nothing else about
 * the call site needs to change.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory growth: an unauthenticated attacker could otherwise create
// unlimited distinct keys. Sweep occasionally rather than on every call.
let lastSweep = Date.now();
function sweepIfDue() {
  const now = Date.now();
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) buckets.delete(key);
  }
}

export function isRateLimited(key: string): boolean {
  sweepIfDue();
  const bucket = buckets.get(key);
  if (!bucket) return false;
  if (Date.now() - bucket.windowStart > WINDOW_MS) return false;
  return bucket.count >= MAX_ATTEMPTS;
}

export function recordAttempt(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }
  bucket.count += 1;
}

export function clearAttempts(key: string): void {
  buckets.delete(key);
}
