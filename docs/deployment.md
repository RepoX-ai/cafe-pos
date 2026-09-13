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

   On Supabase use the **transaction pooler** (port 6543) for
   `DATABASE_URL`: serverless functions open far more connections than a
   long-lived server would. That pooler cannot run prepared statements,
   which is fine here — nothing in the codebase calls Drizzle's
   `.prepare()` — but keep it in mind before adding one.
4. Run migrations once against the staging database before the first
   deploy serves traffic. Use the **session pooler** (port 5432 on the
   `...pooler.supabase.com` host) — *not* the transaction pooler, because
   DDL and transaction pooling don't mix, and *not* the direct
   `db.<ref>.supabase.co` host, which resolves to IPv6 only unless the
   project has the IPv4 add-on and will simply time out from most home
   connections. Session mode behaves like a direct connection:
   ```bash
   DATABASE_URL=<session-pooler-url> npm run db:migrate
   ```
5. Create the account you'll log in with. A freshly migrated database has
   no users, and `npm run db:seed` refuses to run with
   `NODE_ENV=production` (it creates accounts behind a password that is
   public in this repo's history):
   ```bash
   DATABASE_URL=<session-pooler-url> npm run db:create-owner
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
# edit .env: real AUTH_SECRET (openssl rand -base64 32), PRINT_PROVIDER, etc.
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

`X-Forwarded-For` matters here: the login rate limiter
(`src/lib/auth/rate-limit.ts`) and audit log both read it to identify the
real client IP behind the proxy.

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

## Printer hardware

None of the above changes once a real printer is confirmed — set
`PRINT_PROVIDER=bridge` plus `PRINT_BRIDGE_URL`/`PRINT_BRIDGE_SECRET`,
and implement `src/printing/providers/bridge-printer.ts` against
whatever protocol the hardware speaks (PRD §20 has the open questions to
resolve with the café first). Everything else in the order/print pipeline
is provider-agnostic already.
