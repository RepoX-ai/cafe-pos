#!/usr/bin/env bash
# Database + menu images. Run as the dedicated backup operator, from cron.
# RCLONE_REMOTE must name a configured crypt remote. Local-only operation
# requires ALLOW_LOCAL_ONLY_BACKUP=1 explicitly and is not disaster recovery.
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/cafe-pos}"
DEST="${BACKUP_DIR:-/var/backups/cafe-pos}"
KEEP_DAYS="${KEEP_DAYS:-35}"
[[ "$KEEP_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo 'KEEP_DAYS must be a positive integer.' >&2; exit 2; }
cd "$APP_DIR"
# Read one value as data, never source/eval a dotenv file.
if [[ -z "${RCLONE_REMOTE:-}" && -f .env ]]; then
  RCLONE_REMOTE="$(sed -n 's/^RCLONE_REMOTE=//p' .env | tail -n 1 | tr -d '\r')"
  RCLONE_REMOTE="${RCLONE_REMOTE%\"}"; RCLONE_REMOTE="${RCLONE_REMOTE#\"}"
  RCLONE_REMOTE="${RCLONE_REMOTE%\'}"; RCLONE_REMOTE="${RCLONE_REMOTE#\'}"
fi
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  # Reject local paths and connection strings. Only configured encrypted remotes.
  [[ "$RCLONE_REMOTE" =~ ^[a-zA-Z0-9_-]+: ]] || { echo 'Use a named rclone crypt remote.' >&2; exit 2; }
  REMOTE_NAME="${RCLONE_REMOTE%%:*}:"
  rclone listremotes --long | awk -v name="$REMOTE_NAME" '$1 == name && $2 == "crypt" {found=1} END {exit !found}' || {
    echo 'Off-site backup destination must be an rclone crypt remote.' >&2; exit 2;
  }
elif [[ "${ALLOW_LOCAL_ONLY_BACKUP:-0}" != 1 ]]; then
  echo 'Set RCLONE_REMOTE to an off-site crypt remote, or explicitly set ALLOW_LOCAL_ONLY_BACKUP=1.' >&2
  exit 2
else
  echo 'WARNING: local-only backup; server loss will also lose these backups.' >&2
fi

mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd -P)"
chmod 700 "$DEST"
exec 9>"$DEST/.backup.lock"
flock -n 9 || { echo 'Another backup is running.' >&2; exit 1; }
STAMP="$(date -u +%Y%m%d-%H%M%S)-$$"
TEMP_DIR="$(mktemp -d "$DEST/.partial-XXXXXXXX")"
trap 'rm -rf -- "$TEMP_DIR"' EXIT
DB_FILE="db-$STAMP.dump"
MEDIA_FILE="menu-images-$STAMP.tar.gz"
MANIFEST="backup-$STAMP.sha256"

echo "[$(date -Is)] backup start"
docker compose exec -T db pg_dump -U postgres -F c -d cafe_pos > "$TEMP_DIR/$DB_FILE"
[[ -s "$TEMP_DIR/$DB_FILE" ]]
docker compose exec -T db pg_restore --list < "$TEMP_DIR/$DB_FILE" > /dev/null
docker compose exec -T app tar czf - -C /app/var/uploads/menu . > "$TEMP_DIR/$MEDIA_FILE"
gzip -t "$TEMP_DIR/$MEDIA_FILE"
(cd "$TEMP_DIR" && sha256sum "$DB_FILE" "$MEDIA_FILE" > "$MANIFEST")
# Publish only after both archives validate; the manifest marks a complete pair.
mv "$TEMP_DIR/$DB_FILE" "$TEMP_DIR/$MEDIA_FILE" "$DEST/"
mv "$TEMP_DIR/$MANIFEST" "$DEST/"
if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  for FILE in "$DB_FILE" "$MEDIA_FILE" "$MANIFEST"; do
    rclone copyto "$DEST/$FILE" "${RCLONE_REMOTE%/}/$FILE"
  done
  echo "[$(date -Is)] encrypted off-site copy completed"
fi
# Never prune if any dump, validation, or upload failed. Remote retention is
# configured separately; this script never deletes remote recovery copies.
find "$DEST" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'menu-images-*.tar.gz' -o -name 'backup-*.sha256' \) -mtime +"$KEEP_DAYS" -delete
echo "[$(date -Is)] backup done: $MANIFEST"
