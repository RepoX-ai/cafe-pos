# Production-readiness remediation — 23 Sep 2026

Status of the twelve audit findings after remediation, with the evidence for
each, what was verified, and what still blocks production.
**Production readiness is not declared**: see [Remaining blockers](#remaining-blockers).

## Finding status

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Cross-tenant references (menu category, modifier groups, purchase supplier) | **Fixed** | Every referenced id is checked against the caller's business inside the write's transaction; joins that expose names (category, supplier, ingredient, modifier group) also filter on the joined row's business. Migrations 0015–0018 add composite `(business_id, …)` foreign keys for categories, modifier assignments, recipe lines, modifier recipe lines, purchase and preferred suppliers. 0016 checks existing data first and refuses with row ids; it caught a real cross-tenant row in upgrade testing and rolled back atomically. `tests/integration/tenant-references.test.ts` (6 tests: references, reads, mutations by known UUID, DB backstop). Not constrained in the database: variant/option ownership and history tables whose ingredient FK is `ON DELETE SET NULL` (service-checked). No row-level security. |
| 2 | Shared-account concurrency | **Fixed** | One lock order (`src/server/services/locks.ts`): account row lock for linking, password reset, identity edit, account deletion and business creation; checks re-run inside the lock; bcrypt before the lock. Login creates its session under a share lock re-checking the verified hash; self-service password change is compare-and-set. Account deletion refuses if any other membership exists. `identity-concurrency.test.ts`: 8 deterministic tests (interleavings forced via held locks); 10 of 12 tests in the file fail on the previous code. |
| 3 | Owner and recipe invariants | **Fixed** | Per-business roster lock around demote, deactivate and delete; deactivation now also refuses the last active owner and your own account. Recipe saves lock the variant row (covers the first save) and number from `max(version)`; unique indexes allow one active recipe per variant and no repeated version. Modifier recipe replacement and modifier-group assignment lock their option/item row. Tests: concurrent first saves (fails on old code), DB backstops, concurrent owner demotions/deactivation. **Behaviour change:** Super Admin memberships can no longer have their password reset or be deactivated from the staff screen (edit/delete were already blocked). |
| 4 | Expensive reporting | **Fixed** | Dates limited to 2000–2099; report screens, dashboard and exports capped at 366 days with an on-screen note; trend chart bucketed day/week/month (≤ 62 points; year 1–9999 used to allocate 3.65M points); reports use a separate 2-connection pool with a 30 s statement timeout; report-page quota. Unit tests for bounds and buckets. |
| 5 | Export streaming and scaling | **Fixed** | Pull-based stream (one batch ahead), keyset batches with a microsecond-exact cursor, one READ ONLY REPEATABLE READ snapshot, rollback+release on completion, error, timeout, cancel, abort and never-read streams; 100k-row cap checked before streaming; 120 s cap; one export per business and 2 across all instances (advisory locks); reports pool only. No background queue (a year of any report is under the cap). `report-exports.test.ts`: 10 tests incl. slow reader, cancellation, concurrent writes, 20k rows. Found and fixed during testing: a stream cancelled before its first pull leaked its connection. |
| 6 | Report query scope (category + modifiers) | **Fixed** | Rewritten to join modifiers to the café's in-range lines. `EXPLAIN (ANALYZE, BUFFERS)` on 456k orders: 1 day 253 → 1.2 ms, 30 days 346 → 72 ms, 366 days 415 → 284 ms, identical totals; two alternative rewrites measured and rejected. Other report queries surveyed ([performance.md](performance.md)); 30-day category/menu-item/ranking reports still scan all cafés' order lines under default planner costs — documented, not changed. |
| 7 | Rate limiting and request bounds | **Fixed** | Existing atomic PostgreSQL limiter kept. New quotas: stock-affecting writes, admin writes, uploads, staff (de)activation, report pages, business creation/switching; all keyed by business+user. Checkout retries never refused; past a retry quota the print step is skipped. Concurrent-work limits kept separate (reports pool, export slots, bcrypt limiter). Array/string/number/date bounds on every write schema plus overflow guards where values multiply. Missing/malformed/ambiguous client-IP config stops production startup. Flood protection documented for Nginx. Tests: limiter concurrency (existing), bounds, limiter, retry bound, trusted-IP config. |
| 8 | Deployment configuration and DB privileges | **Fixed in the repository; deployment unverified** | App and Postgres published on 127.0.0.1 only; operational settings passed through; `PRINT_PROVIDER`, `APP_DB_PASSWORD` required. Least-privilege runtime role (rows only; no DDL, TRUNCATE, migrations table, or ledger/audit rewrites) created by the migrate step, which alone holds owner credentials. Whole integration suite passes as that role; privileged statements denied. Pool settings validated; statement/lock/idle-in-transaction timeouts; connection budget and upgrade path documented. **Docker was not available here: `docker-compose.yml` and the Dockerfile change were not built or run.** |
| 9 | Write reliability | **Fixed** | `request_idempotency` table keyed by business + operation + key, claimed in the same transaction as the write, payload-hash mismatch refused; used by purchases, waste, adjustments, stock counts and expenses; the forms send a key that survives a lost-response retry. Mutation and audit row now commit together across services (menu, ingredients, suppliers, expenses, settings, branding, business switching, login). Raw error messages (which carried SQL and parameters) no longer reach the client. `write-idempotency.test.ts` (6 tests) and a lost-response purchase in the browser. Catalog creates (e.g. a category) are not keyed. |
| 10 | Performance | **Partly fixed, per evidence** | Reports pool split: under mixed load checkout p99 22.7 ms vs 96.8 ms with reporting on the shared pool. Trigram index for order search (68 → ~1 ms), capped counts (38–96 → 1–4 ms), browsing capped at 10,000 rows, keyset export batches, narrower dashboard payloads. Measured and deliberately *not* changed: POS cache split (catalog read is 0.5 ms), checkout round trips (lock waits rare), pool sizes. Repeatable test: `npm run test:perf`. |
| 11 | Operational gaps | **Fixed, except as noted** | No Sentry integration exists; `SENTRY_DSN` removed from docs and a set value is logged as ignored (not implemented). Structured JSON logs for request errors, slow queries/transactions, pool waits, idle-client errors, rate-limit and work-limit refusals, export outcomes; added the missing pool `error` handler (an idle-connection error would have crashed the process). Production refuses unknown/unset print providers and `bridge`. Timezone enforced install-wide at build time (client and server previously could disagree). Nonce CSP without `script-src 'unsafe-inline'`; `upgrade-insecure-requests` only for HTTPS (on HTTP it stopped the app's scripts loading). Executable restore drill (`scripts/verify-backup.sh`), run successfully. The historical dump leak is **not** remediated here — see blockers. |
| 12 | Dependency security | **Fixed** | GHSA-vcvr-r3jv-pc5j / CVE-2026-94545 affects next ≥16.2.0 <16.3.6 and needs the Node `ImageResponse` (`next/og`) with attacker-controlled SVG input; no such usage exists, so it was not reachable. Upgraded next and eslint-config-next to 16.3.6. `npm audit --omit=dev`: 0. Remaining: 4 moderate dev-only (esbuild dev server via drizzle-kit; npm's suggested fix is a major downgrade), not applicable at runtime. |

Also found and fixed along the way: a typed-cost vs. purchase race in
`updateIngredient`; `switchBusinessAction` passing an unvalidated id to a uuid
column and writing its audit rows outside the move; four e2e specs made stale
by the required cash-tender step.

## Verification

| Check | Result |
|---|---|
| ESLint, `tsc --noEmit` | clean |
| Unit tests | 201 passed (was 183) |
| Integration tests, fresh migrated PostgreSQL 17 | 175 passed (was 137), twice: as owner and as the least-privilege role |
| Migrations, fresh database | all 21 applied |
| Migrations, existing data (old schema, dev + menu seeds, old test data: 159 businesses, 436 orders) | preflight refused one real cross-tenant row, nothing applied; after the documented fix all applied, backfill complete, data preserved, suite passes on the upgraded database |
| Production build (`next build`) | passes |
| Browser, production build, runtime DB role, Chromium tablet profile | 15 passed: login and role routing, POS checkout, double tap, lost-response checkout retry (one order), Bluetooth print via simulator, lost-response purchase resubmit (one receipt, stock once), business switching, recipe versioning, CSV export + range cap, zero CSP violations |
| Startup with bad config (no client IP, `bridge`, malformed proxy count, timezone mismatch, malformed pool size) | each refused with a message; valid config starts |
| Restore drill | 330 KB dump restored, checked, dropped (exit 0); corrupt file exit 1 |
| Mixed load (6 tablets + dashboards + export, 45 s phases, 456k-order dataset) | checkout p50/p95/p99 9.5/18.0/22.7 ms, 0% errors, 0 app-pool waiters, 0 ledger drift ([performance.md](performance.md)) |

**Limits of this verification:** one Windows desktop (Ryzen 7 9700X, 31 GB,
PostgreSQL 17 locally; production Compose uses 16); service-level load test
without HTTP/Next.js/TLS/network; browser tests over plain HTTP on
Chromium only (WebKit/iPad cannot keep the Secure session cookie on HTTP);
no Docker, no real tablet or printer, no managed-database pooler. None of
these numbers is a production capacity figure.

## Remaining blockers

Operator actions, each to be confirmed independently:

1. **Git history leak** ([security-incident-backup-in-git.md](security-incident-backup-in-git.md)):
   purge history on every remote and clone; rotate the database passwords
   and other secrets from that period; rotate `AUTH_SECRET` and clear
   `sessions`; reset every user password in the leaked dump. None of this
   is verified.
2. **Serve over HTTPS** behind Nginx with the flood limits in
   [deployment.md](deployment.md#2-reverse-proxy-https-and-flood-protection);
   keep the app port on 127.0.0.1.
3. **Validate the Compose setup on the VPS** (not run here): set
   `APP_DB_PASSWORD`, `PRINT_PROVIDER=device`, `TRUSTED_PROXY_COUNT=1`,
   `APP_URL=https://…`; `docker compose config`, build, then the upgrade
   sequence (backup → restore drill → `docker compose run --rm migrate`,
   fixing any preflight rows → start app). Confirm the grants actually in
   force.
4. **Real devices**: checkout, Bluetooth printing and retry on the Galaxy Tab
   + iWare printer over HTTPS; any iPad/Safari use over HTTPS.
5. **Measure on the VPS** with `npm run test:perf` against a copy of real
   data, and decide on `random_page_cost` from that.

Decisions for the owner:

- A temporary password issued by one café stays valid after another café
  links that account (a sequential case, not a race). Options: require the
  person to set their own password before linking, or accept it.
- Super Admin memberships are now protected from password reset and
  deactivation on the staff screen (previously only edit/delete).
- Tenant isolation relies on application checks and foreign keys; row-level
  security remains a known gap.
