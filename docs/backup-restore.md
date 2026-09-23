# Backup and restore

PostgreSQL holds everything durable: orders, inventory, menu, audit logs,
sessions, rate-limit buckets and idempotency keys. Menu photos uploaded with
`STORAGE_PROVIDER=local` live in the `cafe_pos_menu_images` volume — back
that directory up too (or use S3 storage).

## Docker Compose (local / single-VPS deployment)

### Backup

```bash
docker compose exec -T db pg_dump -U postgres -F c -d cafe_pos > backup-$(date +%Y%m%d-%H%M).dump
```

`-F c` is the custom/compressed format that `pg_restore` reads. Store dumps
**off the VPS** and encrypted (object storage, another machine) — a backup
next to the database survives a bad deploy but not a disk failure — and
never in git (see below).

Always take one before `docker compose run --rm migrate`.

### Nightly backups

On the host (not inside a container), with a retention sweep:

```cron
0 3 * * * cd /opt/cafe-pos && docker compose exec -T db pg_dump -U postgres -F c -d cafe_pos > /var/backups/cafe-pos/$(date +\%Y\%m\%d).dump && find /var/backups/cafe-pos -name '*.dump' -mtime +35 -delete
```

Keep at least 7 daily and 4 weekly dumps, and copy them off-host.

## Restore drill (do this; an untested backup is a hope)

`scripts/verify-backup.sh` restores a dump into a **new, throwaway
database**, checks it, and drops it. It never touches the live database: the
scratch name is generated (`cafe_pos_restore_check_<timestamp>`).

```bash
# On the Compose host:
scripts/verify-backup.sh --docker /var/backups/cafe-pos/20260101.dump

# With plain PostgreSQL client tools (managed database, another machine):
PGHOST=... PGUSER=... PGPASSWORD=... scripts/verify-backup.sh backup.dump

# Keep the restored copy to point a staging app at it:
scripts/verify-backup.sh --docker --keep backup.dump
```

It fails (non-zero exit) if the file is not a restorable dump, if the restore
errors, or if the result has no migrations, users or businesses. It then
prints row counts, the latest order/ledger/audit timestamps (check they
match when the backup was taken) and data checks marked PASS or WARN:

- stock matches the inventory ledger for every ingredient,
- order subtotals match their lines,
- every business has an active owner,
- at most one active recipe per variant.

A WARN needs a person: stock set outside the app (seed scripts, manual SQL)
or orders inserted by hand show up there.

Verified 23 Sep 2026 against a 330 KB dump of a pre-upgrade test database
(159 businesses, 436 orders): restored, checked and dropped, exit 0; a
corrupt file exited 1 and still dropped its scratch database.

Then, at least once before go-live, go further with a kept copy:

1. `scripts/verify-backup.sh --docker --keep <dump>`
2. Run the app against the kept database (a staging `DATABASE_URL`), and
   `docker compose run --rm migrate` against it if the dump predates the
   current schema.
3. Confirm: login works, an order's history and receipt are intact,
   inventory quantities match what they were at backup time, the audit log
   is present.
4. Drop it: `docker compose exec db dropdb -U postgres <name>`.

### Restore for real (fresh environment)

```bash
docker compose up -d db
# wait for the healthcheck, then into an EMPTY database:
docker compose exec -T db pg_restore -U postgres -d cafe_pos --no-owner --exit-on-error < backup.dump
docker compose run --rm migrate   # brings an older dump up to date, and re-grants the app role
docker compose up -d app
```

Restoring over a database that already has data (`--clean --if-exists`)
drops objects first — only do that deliberately, after a fresh backup.

## Managed Postgres (staging / production option A)

Use the provider's own backups and point-in-time recovery as the primary
mechanism, and still export a portable dump you control and run the drill on
it:

```bash
pg_dump "$MIGRATION_DATABASE_URL" -F c > backup-$(date +%Y%m%d).dump
PGHOST=... PGUSER=... PGPASSWORD=... scripts/verify-backup.sh backup-20260101.dump
```

## Never commit dumps to git

Do **not** store `pg_dump` output under `backups/` in the repository, and do
not commit `*.sql` / `*.dump` backups. The directory is gitignored for that
reason. If a dump was ever committed, follow
[security-incident-backup-in-git.md](security-incident-backup-in-git.md) —
history purge and credential rotation are required separately from deleting
the file on `main`.
