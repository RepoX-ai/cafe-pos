# Performance evidence

Measured 23 Sep 2026. These are measurements of the service layer and
PostgreSQL on one development machine, not a statement of production
capacity: they exclude HTTP, Next.js rendering, TLS, the reverse proxy and
network latency to the tablets, and the VPS will have fewer, slower cores.

## Setup

- **Machine:** Windows 11, AMD Ryzen 7 9700X (16 threads), 31 GB RAM; Node 25.8.1;
  PostgreSQL 17.11 on the same machine, default configuration
  (`random_page_cost = 4`). Production Compose uses PostgreSQL 16.
- **Dataset** (`npm run perf:seed`, fictional): 5 cafés × 365 days × 250 orders a day —
  456k orders, 913k order lines, 548k line modifiers, 2.74M ledger rows,
  2.7 GB. Each café: 40 items × 2 variants, 30 ingredients, 3-line recipes,
  3 modifier groups.
- **Repeat it:** create a disposable database whose name contains `perf`, then
  ```bash
  DATABASE_URL=.../cafe_pos_perf npm run db:migrate
  DATABASE_URL=.../cafe_pos_perf npm run perf:seed
  PERF_DATABASE_URL=.../cafe_pos_perf npm run test:perf
  ```
  Results land in `perf-results/` (gitignored).

## Mixed workload (`tests/perf/mixed-workload.perf.ts`)

6 simulated tablets submitting orders through the real `submitOrderForUser`
(1–3 lines, half with a modifier, 0–150 ms think time, 5% lost-response
retries) against 3 cafés; in the mixed phases also 2 loops loading the
dashboard's 9 queries over 30 days and 1 CSV exporter reading a week of
ledger with a pause between batches. 45 s per phase, default pools (app 5,
reports 2).

| Phase | Checkouts | p50 | p95 | p99 | max | Errors | App-pool waiters (max) | Lock waiters (max; samples with any) |
|---|---|---|---|---|---|---|---|---|
| Checkout only | 3,104 (69/s) | 7.8 ms | 10.7 ms | 13.1 ms | 128.5 ms | 0% | 1 | 2; 7 of 433 |
| Mixed — reporting on the reports pool | 3,052 (68/s) | 9.5 ms | 18.0 ms | 22.7 ms | 47.4 ms | 0% | 0 | 2; 18 of 440 |
| Mixed — reporting on the app pool (the old arrangement) | 2,865 (64/s) | 11.5 ms | 56.4 ms | 96.8 ms | 119.4 ms | 0% | 14 | 1; 5 of 437 |

Dashboard load (9 queries): p50 146 ms / p95 259 ms on the reports pool,
86 / 143 ms when it could take app connections. CSV export of a week of
ledger with a slow reader: p50 720 ms. Process memory peaked at 358 MB RSS
in every phase (bounded by the one-batch-ahead export stream). After every
phase, each touched ingredient's stock change equalled the sum of the ledger
rows written during it (**0 drift**), and every lost-response retry returned
the original order.

What this supports: moving reports and exports to their own small pool keeps
checkout latency near its unloaded level (p99 22.7 ms vs 96.8 ms), because
the dashboard's nine parallel queries no longer take all five checkout
connections. Checkout's ingredient/counter lock waits were rare and short at
this load, so restructuring checkout's round trips (e.g. combining its
inserts into one statement) is not justified by this evidence.

## Report query plans (`tests/perf/query-plans.perf.ts`)

The exact SQL each service issues, run with `EXPLAIN (ANALYZE, BUFFERS)` on
one café, single run (so a few ms of noise), after the changes:

| Query | Stmts | Execution | Buffers | Seq scan of a large table |
|---|---|---|---|---|
| Summary, 30 days | 1 | 4.5 ms | 5.6k | none |
| Sales trend, 30 days daily / 180 days weekly | 1 | 10.4 / 49.1 ms | 5.6k / 10.5k | none |
| Category + modifiers, 1 day | 1 | 1.3 ms | 3.2k | none |
| Category + modifiers, 30 days | 1 | 130.6 ms | 99.6k | order_lines |
| Category / menu item / rankings, 30 days | 1 | 59–124 ms | 22.6k | order_lines |
| Payment methods, 30 days | 1 | 3.6 ms | 5.6k | none |
| Orders list page 1 / page 500 | 2 | 1.4 / 3.9 ms | 0.1k / 9.3k | none |
| Orders search "123" | 2 | 2.7 ms | 3.2k | none |
| Ledger page 1 / capped count / keyset export batch | 1 | 0.1 / 1.1 / 0.5 ms | small | none |
| POS menu (whole catalog + availability) | 8 | 0.5 ms | 70 | none |

### Category sales with modifiers (the dashboard pie)

The old query grouped **every** `order_line_modifiers` row in the
installation per line before joining to the café's orders. Three rewrites
were measured (median of 5 `EXPLAIN ANALYZE` runs, identical totals in every
case):

| Range | Original | CTE-scoped | Per-line LATERAL | Grouped join (shipped) |
|---|---|---|---|---|
| 1 day | 253 ms (551k buffers) | 1.9 ms | 1.1 ms | **1.2 ms (3.3k)** |
| 30 days | 346 ms (1.67M) | 123 ms | 83 ms | **72 ms (75k)** |
| 366 days | 415 ms (1.69M, parallel) | 502 ms | 598 ms | **284 ms (43k)** |

### Changes made because of these measurements

| Change | Before | After |
|---|---|---|
| Trigram index on `orders.order_number` (substring search) | 68 ms, sequential scan of every café's orders | ~1 ms (3+ characters) |
| List counts stop at 10,001 (`countUpTo`); pager shows "10,000+" | orders 34–38 ms, ledger 96 ms (full scans) | 1.1–3.9 ms |
| Browsing capped at the newest 10,000 rows per list | page param allowed OFFSET 2,000,000; OFFSET 100k measured 67–70 ms | max OFFSET 9,980 |
| Dashboard trend bucketed by week/month beyond 62 days | one point per day, unbounded (3.65M objects for year 1–9999) | ≤ 62 points |

### Not changed, with reasons

- **30-day category/menu-item/ranking reports** still scan all cafés'
  `order_lines` with the default planner costs (59–130 ms here, growing with
  total history). With `random_page_cost = 1.1` (normal for SSDs) the same
  queries use tenant-scoped index scans (24–35 ms), but a full ledger count
  got slower (98 → 157 ms), so it is documented as a server setting to
  measure ([deployment.md](deployment.md#planner-setting-for-ssd-servers))
  rather than forced. Denormalising `business_id`/`created_at` onto
  `order_lines` would fix it structurally; not justified at this size.
- **POS menu cache**: splitting the cached catalog from live stock
  availability was considered. The whole catalog read is 8 statements and
  0.5 ms of database time, and availability would still need a per-load
  query, so invalidating the cache after each checkout costs about one
  sub-millisecond rebuild. Kept as is.
- **Pool sizes**: left at 5 + 2. The mixed test shows no app-pool waiting
  with the split; raising them without a measured need just adds contention.
