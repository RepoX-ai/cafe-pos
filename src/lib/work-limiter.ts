import { log } from "@/lib/observability/log";

/**
 * A concurrent-work limit, as opposed to a request quota (rate-limit.ts):
 * at most `max` tasks of this kind run at once in this process, up to
 * `maxQueue` more wait their turn, and anything beyond that is refused
 * immediately with `WorkLimitExceededError` instead of piling up.
 *
 * Per process on purpose — it protects this process's CPU/event loop.
 */
export class WorkLimitExceededError extends Error {
  constructor(readonly limiter: string) {
    super("The server is busy. Try again in a moment.");
    this.name = "WorkLimitExceededError";
  }
}

export interface WorkLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly queued: number;
}

export function createWorkLimiter(name: string, max: number, maxQueue: number): WorkLimiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) {
      active++;
      next();
    }
  };

  return {
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active < max) {
        active++;
      } else if (waiting.length < maxQueue) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        log("warn", "work_limit.rejected", { limiter: name, active, queued: waiting.length });
        throw new WorkLimitExceededError(name);
      }
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

export function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive whole number (got "${raw}").`);
  return value;
}
