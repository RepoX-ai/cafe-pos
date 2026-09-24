#!/usr/bin/env bash
# Nightly backup: database dump + uploaded menu photos, pruned after
# KEEP_DAYS, optionally copied off the server with rclone. Cron runs it
# (docs/go-live-runbook.md, step 10):
#
#   0 3 * * * bash /opt/cafe-pos/deploy/backup.sh >> /var/backups/cafe-pos/backup.log 2>&1
#
# Off-server copy: set RCLONE_REMOTE (e.g. "cafepos-crypt:backups") in
# /opt/cafe-pos/.env. Without it, backups stay on this disk only — which
# survives a bad deploy but not the server being lost.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cafe-pos}"
DEST="${BACKUP_DIR:-/var/backups/cafe-pos}"
KEEP_DAYS="${KEEP_DAYS:-35}"
STAMP="$(date +%Y%m%d-%H%M)"

cd "$APP_DIR"
RCLONE_REMOTE="${RCLONE_REMOTE:-$(grep -E '^RCLONE_REMOTE=' .env 2>/dev/null | cut -d= -f2- || true)}"

echo "[$(date -Is)] backup start"

# Write to a temporary name first, so a failed dump never looks like a good one.
docker compose exec -T db pg_dump -U postgres -F c -d cafe_pos > "$DEST/.db-$STAMP.partial"
mv "$DEST/.db-$STAMP.partial" "$DEST/db-$STAMP.dump"

docker compose exec -T app tar czf - -C /app/var/uploads/menu . > "$DEST/.menu-$STAMP.partial"
mv "$DEST/.menu-$STAMP.partial" "$DEST/menu-images-$STAMP.tar.gz"

find "$DEST" -maxdepth 1 \( -name 'db-*.dump' -o -name 'menu-images-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name '.*.partial' -mtime +1 -delete

if [[ -n "$RCLONE_REMOTE" ]]; then
  rclone copy "$DEST" "$RCLONE_REMOTE" --include 'db-*.dump' --include 'menu-images-*.tar.gz' --max-age 48h
  echo "[$(date -Is)] copied off-server to $RCLONE_REMOTE"
fi

echo "[$(date -Is)] backup done: db-$STAMP.dump ($(du -h "$DEST/db-$STAMP.dump" | cut -f1))"
