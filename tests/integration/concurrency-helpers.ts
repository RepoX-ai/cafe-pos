import type { Pool, PoolClient } from "pg";

/**
 * A transaction on its own connection that holds a lock while the test
 * lines other work up behind it. `waitForBlocked(n)` returns once PostgreSQL
 * reports `n` backends blocked by this one — so the interleaving a test
 * asserts on is the one that actually happened, not a timing guess.
 * PostgreSQL grants conflicting lock waiters in queue order on release.
 */
export class LockHolder {
  private constructor(private pool: Pool, private client: PoolClient, readonly pid: number) {}

  static async begin(pool: Pool): Promise<LockHolder> {
    const client = await pool.connect();
    await client.query("begin");
    const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    return new LockHolder(pool, client, rows[0].pid);
  }

  query(text: string, values?: unknown[]) {
    return this.client.query(text, values);
  }

  async waitForBlocked(count: number, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // Polled on a separate autocommit connection: pg_stat_activity is
      // snapshotted once per transaction, so the holder's own open
      // transaction would keep seeing the same stale rows.
      // A row-lock waiter queued behind another waiter is blocked by that
      // waiter (it holds the tuple lock), not directly by the holder — so
      // count the whole wait chain rooted here.
      const { rows } = await this.pool.query<{ n: number }>(
        `with recursive chain(pid) as (
           select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))
           union
           select a.pid from pg_stat_activity a join chain c on c.pid = any(pg_blocking_pids(a.pid))
         )
         select count(*)::int as n from chain`,
        [this.pid],
      );
      if (rows[0].n >= count) return;
      if (Date.now() > deadline) throw new Error(`Only ${rows[0].n} of ${count} backends blocked on pid ${this.pid}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async commit() {
    try {
      await this.client.query("commit");
    } finally {
      this.client.release();
    }
  }

  async rollback() {
    try {
      await this.client.query("rollback");
    } finally {
      this.client.release();
    }
  }
}

/** Waits for a promise that must stay pending while blocked, surfacing an early settle as a failure. */
export function track<T>(promise: Promise<T>) {
  const state: { settled: boolean } = { settled: false };
  const wrapped = promise.finally(() => {
    state.settled = true;
  });
  // Avoid unhandled-rejection noise; the test awaits `wrapped` itself.
  wrapped.catch(() => undefined);
  return { promise: wrapped, state };
}
