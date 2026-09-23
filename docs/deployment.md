# Deployment

Three targets, same codebase, no environment-specific forks. See
[backup-restore.md](backup-restore.md) for the database side of this, and
[performance.md](performance.md) for measured capacity and the evidence behind
the pool and index choices.

**Production must be served over HTTPS.** Session cookies are `Secure` in
production; browsers will not keep them on a plain-HTTP origin (other than
Chromium on `localhost`), so login does not work over plain HTTP.

## What refuses to start

A production process (`NODE_ENV=production`) stops at startup, with a message
naming the setting, when any of these is missing or malformed — they would
otherwise fail silently:

| Setting | Rule |
|---|---|
| `AUTH_SECRET` | at least 32 characters, not a known placeholder |
| Client IP | exactly one of `TRUSTED_PROXY_COUNT` (1–9), `TRUSTED_CLIENT_IP_HEADER` (a known client-IP header), or `TRUSTED_CLIENT_IP_NONE=1` |
| `PRINT_PROVIDER` | `device`, `browser` or `mock`; unset, unknown, or `bridge` (not implemented) is refused |
| Timezone | `NEXT_PUBLIC_BUSINESS_TIMEZONE` (build time) must be a valid IANA zone; a runtime `BUSINESS_TIMEZONE`, if set, must equal it |
| Pools / timeouts / export limits | every `DATABASE_*` and `EXPORT_*` value must be a whole number in range |

A `SENTRY_DSN` is not an error, but it is **not used**: there is no Sentry
integration. Startup logs `config.sentry_dsn_ignored` if one is set.

## Local

Covered in the main [README](../README.md#local-development). Docker
Compose for the whole stack, or Node + any local/managed Postgres.

## Staging: Vercel + managed Postgres

1. Create a managed Postgres database (Supabase per PRD §Hosting, or
   Neon/RDS) — separate from whatever production ends up using.

   **Pick a region next to the café, not next to you.** For a Jakarta
   café that means Southeast Asia (Singapore, `ap-southeast-1`). Vercel
   otherwise defaults to `iad1` (Virginia); functions in Virginia talking
   to a database in Singapore add roughly a quarter-second to *every*
   query, and the dashboard pages issue several in sequence. `vercel.json`
   pins functions to `sin1` to match — change both together if the café
   is somewhere else.
2. Import the project into Vercel from this repo.
3. Set environment variables in the Vercel project (from `.env.example`):
   `DATABASE_URL`, `AUTH_SECRET`, `APP_URL` (your `https://` Vercel URL),
   `NEXT_PUBLIC_BUSINESS_TIMEZONE=Asia/Jakarta`, `PRINT_PROVIDER=mock` (or
   `browser` until hardware is confirmed), and
   `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for` (Vercel overwrites that header
   with the real client address, so it is safe to trust there).

   On Supabase use the **transaction pooler** (port 6543) for
   `DATABASE_URL`: serverless functions open far more connections than a
   long-lived server would. That pooler cannot run prepared statements,
   which is fine here — nothing in the codebase calls Drizzle's
   `.prepare()` — but keep it in mind before adding one. If the pooler
   rejects the per-connection timeout parameters (see
   [Database connections](#database-connections)), set
   `DATABASE_SESSION_TIMEOUTS=off`; exports still apply their own
   `SET LOCAL` timeouts.
4. Run migrations once against the staging database before the first
   deploy serves traffic, with the owner credentials:
   ```bash
   MIGRATION_DATABASE_URL=<owner-url> npm run db:migrate
   ```
   The transaction pooler worked for migrations on a real Supabase project
   (Drizzle runs them in one transaction without prepared statements). The
   direct `db.<ref>.supabase.co` host is IPv6-only without the add-on, and
   the session pooler rejected the same credentials there — connect first,
   migrate second. The password must be **URL-encoded** in the URL.

   Migration 0019 creates the `pg_trgm` extension (a trusted extension, so
   the database owner can create it); Supabase, Neon and RDS all ship it.
5. Create the account you'll log in with (`npm run db:seed` refuses
   `NODE_ENV=production`):
   ```bash
   DATABASE_URL=<owner-url> npm run db:create-owner
   ```
6. Deploy, then check `/api/health` — `{"status":"ok","database":"connected"}`
   only if the app can reach the database.
7. Optional, for menu photo uploads: `STORAGE_PROVIDER=s3` and the
   `STORAGE_*` keys. Local disk is refused on Vercel (ephemeral filesystem).
   Supabase Storage needs `STORAGE_FORCE_PATH_STYLE=true`.

Vercel runs many function instances, each with its own pools: see
[Connection budget](#connection-budget).

## Production option A: VPS app + managed Postgres

Same as staging for the database, with the app served as in option B.
Use a least-privilege runtime role (see [Database roles](#database-roles))
created with the SQL in `scripts/lib/db-roles.ts` or by running the migrate
step with `APP_DB_ROLE`/`APP_DB_PASSWORD` set.

## Production option B: fully VPS-hosted (app + Postgres)

### 1. Provision

A small VPS (2 vCPU / 4GB RAM is comfortable for one café) running
Ubuntu/Debian, with Docker + Docker Compose installed.

```bash
git clone <this-repo> /opt/cafe-pos
cd /opt/cafe-pos
cp .env.example .env
# edit .env — every one of these, with fresh values:
#   POSTGRES_PASSWORD   owner / migration credential   (openssl rand -hex 24)
#   APP_DB_PASSWORD     runtime role credential         (openssl rand -hex 24)
#   AUTH_SECRET                                         (openssl rand -base64 32)
#   APP_URL=https://pos.yourcafe.example
#   PRINT_PROVIDER=device
#   TRUSTED_PROXY_COUNT=1          (matches the Nginx config below)
docker compose build
docker compose up -d db
docker compose run --rm migrate      # migrations + the app role and its grants
docker compose up -d app
```

Compose publishes Postgres and the app on `127.0.0.1` only. Do not change
either to `0.0.0.0`: a directly reachable app port lets any client skip
Nginx and send its own `X-Forwarded-For`, which the app trusts.

### 2. Reverse proxy, HTTPS and flood protection

Run Nginx on the host (not in Compose) so certbot can manage certificates.
The app's rate limits are per account and per user, stored in PostgreSQL;
they are not a defence against a flood of requests, which must be stopped
before it reaches Node:

```nginx
# /etc/nginx/conf.d/cafe-pos.conf
limit_req_zone  $binary_remote_addr zone=cafepos_req:10m  rate=20r/s;
limit_req_zone  $binary_remote_addr zone=cafepos_login:10m rate=10r/m;
limit_conn_zone $binary_remote_addr zone=cafepos_conn:10m;

server {
    listen 443 ssl http2;
    server_name pos.yourcafe.example;
    # ssl_certificate ... (certbot fills these in)

    client_max_body_size 5m;        # menu photos are <= 3MB; server actions allow 4MB
    client_body_timeout   15s;
    client_header_timeout 15s;
    keepalive_timeout     30s;
    limit_conn cafepos_conn 30;

    location = /login {
        limit_req zone=cafepos_login burst=10 nodelay;
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/cafe-pos-proxy.conf;
    }
    location /api/exports/ {
        limit_req zone=cafepos_req burst=5;
        proxy_buffering off;         # stream the CSV; the app applies backpressure
        proxy_read_timeout 180s;     # above EXPORT_MAX_SECONDS
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/cafe-pos-proxy.conf;
    }
    location / {
        limit_req zone=cafepos_req burst=40 nodelay;
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/cafe-pos-proxy.conf;
    }
}
server { listen 80; server_name pos.yourcafe.example; return 301 https://$host$request_uri; }
```

```nginx
# /etc/nginx/cafe-pos-proxy.conf
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

A whole café usually shares one public IP: keep the per-IP rates generous
enough for every tablet and back-office PC at once. A CDN or tunnel in front
of Nginx adds one to `TRUSTED_PROXY_COUNT` and moves the flood limits there.

### 3. Process supervision

Compose's `restart: unless-stopped` handles restarts; `systemctl enable
docker` covers reboots.

### 4. Monitoring and logs

The app writes JSON lines to stdout/stderr (`docker compose logs -f app`,
or ship them to any log service). Useful events:

| Event | Meaning |
|---|---|
| `request.error` | an uncaught server error (route, action or render), with digest and route |
| `request.failed` | a handled failure shown to the user with a `ref` id — search logs for the ref a user quotes |
| `db.pool_wait` | waited ≥ `POOL_WAIT_WARN_MS` (200) for a pooled connection |
| `db.slow_query` / `db.slow_transaction` | ≥ `SLOW_QUERY_MS` (500) / `SLOW_TRANSACTION_MS` (1000); statement text only, never parameters |
| `db.idle_client_error` | a pooled connection died (database restart, network) |
| `rate_limit.blocked` | a quota bucket refused a request (rule and business only) |
| `work_limit.rejected` | the bcrypt limiter was full (login/password reset refused as "busy") |
| `export.finished` / `export.abandoned` | CSV export outcome, rows, duration |

Also point an uptime monitor at `/api/health`, and keep Docker log rotation
(set on every service in `docker-compose.yml`).

### 5. Backups

See [backup-restore.md](backup-restore.md) — set up the cron job and run the
restore drill before the café takes real orders.

## Database roles

The app connects as a **least-privilege runtime role** (`APP_DB_ROLE`,
default `cafe_pos_app`): it can read and write rows, and nothing else — no
DDL, no `TRUNCATE`, no access to the migrations bookkeeping, and no
`UPDATE`/`DELETE` on the append-only ledgers (`inventory_movements`,
`audit_logs`). Foreign-key `ON DELETE` actions into those tables still work
(PostgreSQL runs them with the table owner's rights). The full integration
suite runs as this role.

Migrations run as the schema **owner** (`POSTGRES_PASSWORD` in Compose, or
`MIGRATION_DATABASE_URL`). With `APP_DB_ROLE` and `APP_DB_PASSWORD` set, the
migrate step also creates/updates the runtime role and re-applies its grants
(idempotent; see `scripts/lib/db-roles.ts`). The running app never holds the
owner password.

This repository cannot see your server: after setting up, confirm the grants
actually in force, e.g.
`docker compose exec db psql -U postgres -d cafe_pos -c '\dp inventory_movements'`.

### Upgrading an existing install to the app role (and migrations 0015–0020)

Existing Compose installs connected as `postgres`. To move over:

1. **Back up** (`docker compose exec db pg_dump -U postgres -F c -d cafe_pos > pre-upgrade.dump`)
   and run the restore drill on that file.
2. `git pull`, then add `APP_DB_ROLE=cafe_pos_app`, a fresh URL-safe
   `APP_DB_PASSWORD`, `PRINT_PROVIDER` and one client-IP setting to `.env`.
3. `docker compose build && docker compose run --rm migrate`.
   Migration 0016 checks existing data for cross-tenant references and
   duplicate active recipes first. If it stops, nothing was applied and the
   old app keeps working — follow [tenant-integrity-migration.md](tenant-integrity-migration.md),
   then rerun.
4. `docker compose up -d app` (now connecting as the runtime role).

Rollback: to undo only the role switch, point `DATABASE_URL` back at
`postgres`. To go back to the previous *app version*, restore the
pre-upgrade backup: the old code does not know the new
`menu_item_modifier_groups.business_id` column and fails when assigning
modifier groups on the new schema.

The migrations take plain locks while they add constraints and indexes —
well under a second at café volume. On a very large database, build
`orders_order_number_trgm_idx` `CONCURRENTLY` by hand first.

## Database connections

Each app process has two pools:

| Pool | Used by | Default size | Statement timeout | Other |
|---|---|---|---|---|
| app | pages, actions, checkout | `DATABASE_POOL_MAX=5` | 15 s | lock timeout 5 s, idle-in-transaction 30 s |
| reports | dashboard, report screens, CSV exports | `DATABASE_REPORT_POOL_MAX=2` | 30 s | idle-in-transaction 60 s (a stalled export reader) |

Heavy reads queue in the small reports pool instead of taking checkout's
connections; the mixed-load test shows why ([performance.md](performance.md)).
A checkout that can't get an ingredient lock within 5 s fails with a "busy,
try again" message and can be retried safely (idempotency key).

Timeouts are sent as connection startup parameters. A pooler that rejects
them (some PgBouncer setups) needs `DATABASE_SESSION_TIMEOUTS=off`; CSV
exports still set their own with `SET LOCAL`.

### Connection budget

Connections in use at most = instances × (`DATABASE_POOL_MAX` +
`DATABASE_REPORT_POOL_MAX`) + migrations/backups/psql. One Compose app with
defaults is 7, far below Postgres's default `max_connections = 100`.
Scaling to several app instances, or to serverless functions, multiplies the
first term; behind a transaction pooler the pooler's own server-side pool is
the limit to size. Raise pool sizes only with measurements — more
connections than CPU cores mostly adds contention.

### Planner setting for SSD servers

PostgreSQL's default `random_page_cost = 4` assumes spinning disks. On the
perf dataset, `random_page_cost = 1.1` moved 30-day reports from a full scan
of every tenant's order lines to tenant-scoped index scans (57 → 24–35 ms),
but made a full-history ledger count slower (98 → 157 ms). For an SSD VPS,
`ALTER SYSTEM SET random_page_cost = 1.1;` is the usual recommendation;
measure with `npm run test:perf` before and after.

## Client IP and rate limits

Request **quotas** (fixed windows stored in PostgreSQL, shared by every
instance): login per IP / account / account+IP, checkout, checkout retries,
print, CSV export, order cancel/refund, staff writes, stock-affecting
back-office writes, other admin writes, uploads, report page loads,
business creation and switching. Defaults and `RATE_LIMIT_*` overrides are
in `.env.example`. Every authenticated bucket is keyed by business and
user, so one café's burst never spends another café's allowance.

A checkout **retry** of an idempotency key that already produced an order
is never refused — the cashier always gets the order back — but past
`RATE_LIMIT_CHECKOUT_RETRY` the print-job step is skipped.

**Concurrent-work** limits are separate: the reports pool size, at most one
CSV export per business and `EXPORT_MAX_CONCURRENT` across all instances
(advisory locks), and `BCRYPT_MAX_CONCURRENT`/`BCRYPT_MAX_QUEUE` hashes per
process (a login flood gets "busy" instead of starving checkout's CPU).

The client IP is only taken from a proxy you configure
(`src/lib/http/client-ip.ts`):

| Deployment | Setting |
|---|---|
| Local `next dev` | none needed |
| Vercel | `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for` |
| VPS behind Nginx (config above) | `TRUSTED_PROXY_COUNT=1` (or `TRUSTED_CLIENT_IP_HEADER=x-real-ip`) |
| LAN-only, no proxy (still HTTPS) | `TRUSTED_CLIENT_IP_NONE=1` — per-IP login buckets are then skipped |

Exactly one is required in production. A header value that isn't exactly
one valid IP address is ignored, never guessed at.

## CSV exports

One export streams from one READ ONLY, REPEATABLE READ snapshot: the file is
exactly the data as of its first query, however long the download takes.
Ranges are capped at 366 days (same as the report screens); an export over
`EXPORT_MAX_ROWS` (100,000) is refused before any byte is sent, asking for a
narrower range; `EXPORT_MAX_SECONDS` (120) cuts a slow download off. There
is no background export queue: at café volume a year of any report is well
under the row cap, so a synchronous stream is enough.

## Caching across instances

The POS menu cache (`unstable_cache`, 20 s) and its invalidation
(`revalidateTag`) are per instance: with several app instances, another
instance may show stock badges up to 20 s old. Checkout always re-reads
prices, recipes and stock inside its transaction, so a stale badge can never
sell something unavailable or at a stale price. A shared cache handler is not
worth it at this scale ([performance.md](performance.md)).

## Timezone

One timezone for the whole install, fixed at build time
(`NEXT_PUBLIC_BUSINESS_TIMEZONE`, a Docker build arg; default Asia/Jakarta)
so the server and the browser agree. `businesses.timezone` is not used.
Changing it means rebuilding the image.

## Security headers

`next.config.ts` sets `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options: DENY` and a `Permissions-Policy` that allows Web Bluetooth
only for the same origin (the POS tablet printer). `src/proxy.ts` sets a
per-request **nonce Content-Security-Policy**: `script-src 'self' 'nonce-…'
'strict-dynamic'` with no `'unsafe-inline'`, `connect-src 'self'`,
`frame-ancestors 'none'`, and `upgrade-insecure-requests` when `APP_URL` is
`https://`. Still permissive: `style-src 'unsafe-inline'` (Tailwind style
attributes, and the browser receipt builds a stylesheet in a popup) and
`img-src https:` (menu photos may be pasted URLs). CSP is defence in depth,
not a substitute for React's output escaping and server-side validation.

## Print job recovery

A print attempt claims its job with a lease (`PRINT_JOB_LEASE_SECONDS`,
default 120). Only the current claim holder can record the result, so a
stalled worker can't overwrite a newer attempt. An abandoned claim shows as
**outcome unknown** and is never reprinted automatically — a person checks
the printer and presses Retry. Each job allows `PRINT_JOB_MAX_ATTEMPTS`
attempts (default 5); after that, Reprint sends a deliberately new receipt.
Delivery guarantee: at most one active claim per job, not exactly-once paper.

## Printer hardware

`PRINT_PROVIDER=device` (the tablet's paired Bluetooth printer, over Web
Bluetooth) is the production path; `browser` opens a printable receipt.
`bridge` is a placeholder with no protocol behind it and is refused in
production until `src/printing/providers/bridge-printer.ts` is implemented
(PRD §20 has the open questions).
