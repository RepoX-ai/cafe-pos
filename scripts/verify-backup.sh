#!/usr/bin/env bash
# Restore-verification drill: restores a pg_dump (custom format) into a NEW,
# throwaway database, runs scripts/verify-restore.sql against it, and drops
# it again. It never touches the live database: the scratch name is
# generated, and the script refuses to run against a name that doesn't start
# with "cafe_pos_restore_check_".
#
#   Docker Compose host:  scripts/verify-backup.sh --docker /var/backups/cafe-pos/20260101.dump
#   Plain client tools:   PGHOST=... PGUSER=... PGPASSWORD=... scripts/verify-backup.sh backup.dump
#
# Options: --keep  leave the restored copy in place (to point a staging app at it).
# Exit status is non-zero if the restore or any structural check fails.
set -euo pipefail

MODE=local
KEEP=0
DUMP=""
for arg in "$@"; do
  case "$arg" in
    --docker) MODE=docker ;;
    --keep) KEEP=1 ;;
    *) DUMP="$arg" ;;
  esac
done
[[ -n "$DUMP" && -f "$DUMP" ]] || { echo "usage: $0 [--docker] [--keep] <backup.dump>" >&2; exit 2; }

SCRATCH="cafe_pos_restore_check_$(date +%Y%m%d%H%M%S)"
[[ "$SCRATCH" == cafe_pos_restore_check_* ]] || exit 2
HERE="$(cd "$(dirname "$0")" && pwd)"

if [[ "$MODE" == docker ]]; then
  pg() { docker compose exec -T db "$@" -U postgres; }
else
  pg() { "$@"; }
fi

cleanup() {
  if [[ "$KEEP" == 0 ]]; then
    pg dropdb --if-exists "$SCRATCH" >/dev/null 2>&1 || true
    echo "Dropped $SCRATCH."
  else
    echo "Kept $SCRATCH for inspection. Drop it with: dropdb $SCRATCH"
  fi
}
trap cleanup EXIT

echo "Restoring $(basename "$DUMP") into $SCRATCH ..."
pg createdb "$SCRATCH"
# --no-owner/--no-privileges: the copy is owned by whoever runs the drill,
# so it restores the same way on a different server.
pg pg_restore --no-owner --no-privileges --exit-on-error -d "$SCRATCH" < "$DUMP"

echo "Running checks ..."
pg psql -X -q -d "$SCRATCH" -f - < "$HERE/verify-restore.sql"
echo "Restore verification finished: the backup restores and passes the structural checks."
echo "Review any WARN lines above."
