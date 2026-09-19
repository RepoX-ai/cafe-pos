# Backup and restore

PostgreSQL is the only stateful service — back up the database and you've
backed up everything (orders, inventory, menu, audit logs). There is no
other durable state: sessions, print-job processing, and rate limiting are
either in the database or safely disposable in-memory state.

## Docker Compose (local / single-VPS deployment)

### Backup

```bash
docker compose exec db pg_dump -U postgres -F c -d cafe_pos > backup-$(date +%Y%m%d-%H%M).dump
```

`-F c` is the custom/compressed format (`pg_restore` target), which handles
large object references and is faster to restore selectively than plain
SQL. Store the resulting `.dump` file off the VPS (object storage, another
machine, etc.) — a backup that lives next to the database it backs up
survives a bad `git pull` but not a disk failure.

### Restore (fresh environment)

```bash
docker compose up -d db
# wait for the healthcheck to pass, then:
cat backup-20260101-0300.dump | docker compose exec -T db pg_restore -U postgres -d cafe_pos --clean --if-exists
npm run db:migrate   # no-op if the dump is already at the latest schema version, safe either way
```

### Automating backups on a VPS

Add a nightly cron job on the host (not inside the container, so it
survives container recreation):

```cron
0 3 * * * cd /opt/cafe-pos && docker compose exec -T db pg_dump -U postgres -F c -d cafe_pos > /var/backups/cafe-pos/$(date +\%Y\%m\%d).dump
```

Keep at least 7 daily + 4 weekly dumps, and periodically verify a dump
actually restores — an untested backup is a hope, not a backup.

## Managed Postgres (staging / production option A)

Use the provider's own backup feature (Supabase, Neon, RDS, etc. all offer
automated daily backups + point-in-time recovery) as the primary mechanism
— it's more reliable than a cron job hitting `pg_dump` from the app server.
Still periodically export a portable `pg_dump` for a copy you control:

```bash
pg_dump "$DATABASE_URL" -F c > backup-$(date +%Y%m%d).dump
pg_restore --clean --if-exists -d "$DATABASE_URL" backup-20260101.dump
```

## Restore drill checklist (PRD §21: "production backups have been tested")

Before relying on this in production, actually do this once, end to end,
against a throwaway database:

1. Take a backup of a database with real-ish data in it.
2. Spin up a brand-new empty Postgres instance.
3. Restore the backup into it.
4. Point `DATABASE_URL` at the restored instance and run the app.
5. Confirm: login works, an order's history is intact, inventory
   quantities match what they were at backup time, and the audit log is
   present.

If any of those fail, the backup isn't done — fix the process before the
café goes live on it.


## Never commit dumps to git

Do **not** store `pg_dump` output under `backups/` in the repository, and do
not commit `*.sql` / `*.dump` backups. The directory is gitignored for that
reason. Keep encrypted copies off-host (object storage, another machine).
If a dump was ever committed, follow
[security-incident-backup-in-git.md](security-incident-backup-in-git.md) —
history purge and credential rotation are required separately from deleting
the file on `main`.
