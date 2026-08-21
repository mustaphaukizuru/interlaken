#!/usr/bin/env bash
# Nightly database backup, run by cron on this box (see crontab.example).
#
#   ./backup-db.sh            # writes /var/backups/interlaken/db-<date>.sql.gz
#
# Replaces the GitHub Actions backup that dumped Supabase over the internet:
# the database now listens only on the private compose network, so the dump has
# to be taken here. pg_dump runs INSIDE the db container, so the client version
# always matches the server (a mismatch is what silently broke the old workflow
# for five nights).
set -euo pipefail

cd "$(dirname "$0")"

DEST="${BACKUP_DIR:-/var/backups/interlaken}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
# A dump smaller than this means pg_dump wrote an error page or an empty
# database, not a backup. Fail loudly instead of rotating good copies away.
MIN_BYTES="${BACKUP_MIN_BYTES:-10240}"

[[ -f .env ]] || { echo "ERROR: deploy/.env missing" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; source ./.env; set +a
: "${DB_NAME:?DB_NAME not set in .env}"
: "${DB_USER:?DB_USER not set in .env}"

mkdir -p "$DEST"
out="$DEST/db-$(date +%F-%H%M).sql.gz"

# --clean --if-exists so the dump can be replayed onto a non-empty database.
docker compose exec -T db \
  pg_dump --no-owner --no-privileges --clean --if-exists \
          -U "$DB_USER" "$DB_NAME" \
  | gzip > "$out"

size=$(stat -c%s "$out")
if (( size < MIN_BYTES )); then
  echo "ERROR: dump is only ${size}B (< ${MIN_BYTES}B) — keeping it as .bad and failing" >&2
  mv "$out" "$out.bad"
  exit 1
fi

# Rotate only after a verified-good dump exists.
find "$DEST" -name 'db-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "$(date -Is) backup ok: $out ($((size / 1024)) KB)"

# A backup that only exists on the machine it protects is not a backup. Set
# BACKUP_REMOTE (e.g. user@host:/path or an rclone remote) to copy it off.
if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null && [[ "$BACKUP_REMOTE" == *:* && "$BACKUP_REMOTE" != *@* ]]; then
    rclone copy "$out" "$BACKUP_REMOTE" && echo "copied off-box with rclone"
  else
    scp -q "$out" "$BACKUP_REMOTE" && echo "copied off-box with scp"
  fi
fi
