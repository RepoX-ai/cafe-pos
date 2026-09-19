# Deployment

Three targets, same codebase, no environment-specific forks. See
[backup-restore.md](backup-restore.md) for the database side of this.

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
   `DATABASE_URL`, `AUTH_SECRET`, `APP_URL` (your Vercel URL),
   `BUSINESS_TIMEZONE=Asia/Jakarta`, `PRINT_PROVIDER=mock` (or `browser`
   until hardware is confirmed).

   Also set `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for`: Vercel overwrites
   that header with the real client address, so it is safe to trust there
   (see [Client IP and rate limits](#client-ip-and-rate-limits)).

   On Supabase use the **transaction pooler** (port 6543) for
   `DATABASE_URL`: serverless functions open far more connections than a
   long-lived server would. That pooler cannot run prepared statements,
   which is fine here — nothing in the codebase calls Drizzle's
   `.prepare()` — but keep it in mind before adding one.
4. Run migrations once against the staging database before the first
   deploy serves traffic.

   Use the **transaction pooler** (port 6543 on the
   `...pooler.supabase.com` host) — the same URL the app uses. The
   textbook advice is to keep DDL off a transaction pooler, but Drizzle's
   migrator runs each migration inside a single transaction and uses no
   prepared statements, so it goes through cleanly; this was verified
   against a real Supabase project (31 tables, one pass, no errors).

   The other two candidates did *not* work on that project, so don't
   burn time on them: the direct `db.<ref>.supabase.co` host has no
   public A record (new projects are IPv6-only without the IPv4 add-on),
   and the session pooler on port 5432 rejected the same credentials the
   transaction pooler accepted. If your project differs, connect first
   and migrate second — a wrong host fails as a DNS or auth error, not
   as anything that mentions migrations.
   ```bash
   DATABASE_URL=<transaction-pooler-url> npm run db:migrate
   ```

   Note that the database password must be **URL-encoded** in the
   connection string. Supabase-generated passwords routinely contain
   characters that silently truncate or corrupt the URL otherwise.
5. Create the account you'll log in with. A freshly migrated database has
   no users, and `npm run db:seed` refuses to run with
   `NODE_ENV=production` (it creates accounts behind a password that is
   public in this repo's history):
   ```bash
   DATABASE_URL=<transaction-pooler-url> npm run db:create-owner
   ```
6. Deploy, then check `/api/health` — it returns
   `{"status":"ok","database":"connected"}` only if the app can actually
   reach the database. Nothing in this codebase depends on Vercel-specific
   APIs (Blob, Cron, Edge Functions) for core workflows, so this step is
   just "point Vercel at the repo" — no staging-only code paths.
7. Optional, needed only for menu photo uploads: set `STORAGE_PROVIDER=s3`
   and the `STORAGE_*` keys. Local disk is deliberately refused on Vercel
   (the filesystem is ephemeral, so uploads would vanish). Supabase
   Storage is S3-compatible and needs `STORAGE_FORCE_PATH_STYLE=true`.

## Production option A: VPS app + managed Postgres

Same as staging, but the Next.js app runs on a café-owned VPS instead of
Vercel (see option B below for the app-serving details) while Postgres
stays managed. Good middle ground: the café isn't operating a database,
but isn't dependent on Vercel either.

## Production option B: fully VPS-hosted (app + Postgres)

### 1. Provision

A small VPS (2 vCPU / 4GB RAM is comfortable for one café) running
Ubuntu/Debian, with Docker + Docker Compose installed, is the fastest path
since it reuses the same `docker-compose.yml` as local dev.

```bash
git clone <this-repo> /opt/cafe-pos
cd /opt/cafe-pos
cp .env.example .env
# edit .env: strong unique POSTGRES_PASSWORD + AUTH_SECRET (openssl rand -base64 32),
# PRINT_PROVIDER, etc. Compose has no insecure defaults and fails if these are unset.
# Postgres is published on 127.0.0.1:5432 only — do not change that to 0.0.0.0.
docker compose up -d --build
docker compose exec app npm run db:migrate
```

### 2. Reverse proxy + HTTPS

Run Nginx on the host (not in Compose) so certbot can manage certificates
normally:

```nginx
server {
    listen 80;
    server_name pos.yourcafe.example;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d pos.yourcafe.example
```

With this config, set `TRUSTED_PROXY_COUNT=1` in `.env` (Nginx appends the
real address to `X-Forwarded-For`), or `TRUSTED_CLIENT_IP_HEADER=x-real-ip`.
Set neither if the app port can be reached without going through Nginx —
anyone could then send their own forwarding headers. See
[Client IP and rate limits](#client-ip-and-rate-limits).

### 3. Process supervision

Docker Compose's own `restart: unless-stopped` (already set in
`docker-compose.yml`) handles container restarts across crashes and VPS
reboots — no separate systemd unit needed for the app itself. If you
enable the reboot-survival systemd unit for Docker
(`systemctl enable docker`), that's the whole story.

### 4. Monitoring / error reporting

Set `SENTRY_DSN` in `.env` to enable error reporting (optional — the app
runs fine without it). At minimum, watch:

- `docker compose logs -f app` for application errors
- the `/api/health` endpoint (used by the container healthcheck already;
  point an external uptime monitor at it too)
- log rotation: Docker's default `json-file` log driver grows unbounded —
  set `max-size`/`max-file` on the `app`/`db` services in
  `docker-compose.yml` (or configure the Docker daemon's default
  `log-driver` options) before this runs unattended for months.

### 5. Backups

See [backup-restore.md](backup-restore.md) — set up the cron job before
the café takes real orders on this, not after.

## Client IP and rate limits

Login, checkout, print retry/reprint and CSV export are throttled with
fixed-window buckets stored in PostgreSQL (the `login_attempts` table), so
every instance — Vercel functions and VPS processes alike — shares the same
limits without Redis. Defaults and `RATE_LIMIT_*` overrides are listed in
`.env.example`.

Login checks three buckets: per client IP (identifier rotation), per
account (guesses spread across addresses), and per account + IP (one
device's typo allowance). Messages never reveal whether an account exists.
Authorization runs before any throttle, and a retried checkout whose
idempotency key already produced an order is never throttled.

The client IP is only taken from a proxy you configure
(`src/lib/http/client-ip.ts`):

| Deployment | Setting |
|---|---|
| Local `next dev`, or Docker with no proxy | Leave both unset. No client IP: per-IP login buckets are skipped; account buckets still apply. |
| Vercel | `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for` |
| VPS behind Nginx with `proxy_set_header X-Real-IP $remote_addr` | `TRUSTED_CLIENT_IP_HEADER=x-real-ip` |
| VPS behind Nginx appending `X-Forwarded-For` | `TRUSTED_PROXY_COUNT=1` (add one for each further proxy/CDN you run in front) |

A header value that isn't exactly one valid IP address is ignored, never guessed at.

**Cleanup.** Expired buckets are deleted in bounded batches after a request
has been answered (`after()`, at most once every 10 minutes per process),
which behaves the same on Vercel and on a long-running server. Limits stay
correct without cleanup; it only bounds table size. Optionally also schedule
`npm run db:cleanup-rate-limits` (e.g. an hourly cron on a VPS).

## Print job recovery

A print attempt claims its job with a lease (`PRINT_JOB_LEASE_SECONDS`,
default 120). Only the current claim holder can record the result, so a
stalled worker can't overwrite a newer attempt.

If a worker dies mid-print, the job stays PROCESSING until its lease
expires. It then shows as **outcome unknown** on the dashboard and the order
page, and is recorded as FAILED (with that explanation) once the order page
is opened or the job is retried. It is **never reprinted automatically**,
because the receipt may already be on paper: a person checks the printer and
presses Retry. Each job allows `PRINT_JOB_MAX_ATTEMPTS` attempts (default 5);
after that, Reprint sends a deliberately new receipt. Retrying the same
Reprint request after a lost response returns the job it already created.

Delivery guarantee: at most one active claim per job and no automatic
duplicate after an ambiguous failure — not exactly-once paper output. A
printer can print while its confirmation is lost.

## Upgrading: migration 0004

`0004_slow_vertigo.sql` adds `order_number_counters`, print-job lease and
request-key columns, `login_attempts.expires_at`, and indexes for the order,
ledger, report, recipe, print-job, expense and audit-log queries. Apply it
before (or together with) the deploy, like every migration:

```bash
DATABASE_URL=<url> npm run db:migrate
```

- Order numbers continue from each business's existing order count, so
  current `PREFIX-00001` sequences carry on unchanged.
- The migrator runs in a transaction, so indexes use plain `CREATE INDEX`,
  which blocks writes to that table while it builds — well under a second at
  a café's volume. On a very large database, create the same-named indexes
  `CONCURRENTLY` by hand during a quiet period first, then run the migration.
- `login_attempts` keeps its name and existing columns, so instances still
  on the previous release keep working during a rolling deploy.

## Printer hardware

None of the above changes once a real printer is confirmed — set
`PRINT_PROVIDER=bridge` plus `PRINT_BRIDGE_URL`/`PRINT_BRIDGE_SECRET`,
and implement `src/printing/providers/bridge-printer.ts` against
whatever protocol the hardware speaks (PRD §20 has the open questions to
resolve with the café first). Everything else in the order/print pipeline
is provider-agnostic already.
