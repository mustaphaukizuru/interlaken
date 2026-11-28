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
#
# The dump holds every family's and every child's data. It stays on this box
# in plaintext (the monthly restore drill needs it, readable only by this
# user), and the ONLY thing that ever leaves the box is a copy encrypted to
# backup-public-key.asc (backup-encrypt.sh): to the dedicated private bucket
# (BACKUP_S3_* in .env, via `manage.py offsite_backup`) and, if set, to
# BACKUP_REMOTE. No encryption, no off-box copy.
#
# The same run archives the uploaded files (the `media` Docker volume: photos
# and documents families and staff upload). That archive is encrypted at once
# and ONLY the ciphertext is kept, here and off the box (media-<date>.tar.gz.gpg):
# restoring it needs the school's private key, like the off-box dumps.
#
# Exit status: 0 = local dump good, uploaded files archived, and every
# configured off-box copy made; 1 = something failed (the console and the
# 07:45 check say what).
set -euo pipefail
# Dumps are readable by this user only, never by other accounts on the box.
umask 077

cd "$(dirname "$0")"
# shellcheck source=backup-encrypt.sh
source ./backup-encrypt.sh

local_ok=""
enc=""
media_plain=""
# If the dump itself fails, say so where the office can see it (console), not
# only in a log nobody reads. An off-box failure after a good dump is recorded
# by offsite_backup instead, so it never marks the local backup as failed.
# The ciphertext is only a transport file: it is removed on every exit.
cleanup() {
  local rc=$?
  [[ -n "$enc" ]] && rm -f "$enc"
  # The uploaded-files archive is never left in plaintext, whatever happened.
  [[ -n "${media_plain:-}" ]] && rm -f "$media_plain"
  if [[ $rc -ne 0 && -z "$local_ok" ]]; then
    docker compose exec -T app python manage.py record_backup --failed --target "${target:-?}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

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
: "${DB_PASSWORD:?DB_PASSWORD not set in .env}"

mkdir -p "$DEST"
out="$DEST/db-$(date +%F-%H%M).sql.gz"

# Back up whichever database the app actually reads, decided exactly the way
# the app decides it (docker-compose.yml: DB_HOST defaults to the db service).
# Getting this wrong is the worst kind of backup bug: it succeeds every night
# against the wrong, empty database and nobody finds out until a restore.
# --clean --if-exists so the dump can be replayed onto a non-empty database.
# --schema=public because a managed database also holds the platform's own
# schemas (auth, storage, realtime, vault...). They are not this app's - Django
# keeps everything in public - and including them makes the dump refuse to
# restore anywhere except that platform: a verified restore of a real backup
# into vanilla Postgres 17 threw three supabase_vault errors before the data.
if [[ -n "${DB_HOST:-}" && "$DB_HOST" != "db" ]]; then
  target="external ($DB_HOST)"
  docker run --rm -e PGPASSWORD="$DB_PASSWORD" postgres:17-alpine     pg_dump --no-owner --no-privileges --clean --if-exists --schema=public             -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME"     | gzip > "$out"
else
  target="local db container"
  docker compose exec -T db     pg_dump --no-owner --no-privileges --clean --if-exists --schema=public             -U "$DB_USER" "$DB_NAME"     | gzip > "$out"
fi

size=$(stat -c%s "$out")
if (( size < MIN_BYTES )); then
  echo "ERROR: dump is only ${size}B (< ${MIN_BYTES}B), keeping it as .bad and failing" >&2
  mv "$out" "$out.bad"
  exit 1
fi

# Rotate only after a verified-good dump exists. (The pattern does not match
# .gpg files; those never stay here, see cleanup.)
find "$DEST" -name 'db-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
# Ciphertext a killed run could not remove (cleanup runs on every normal exit).
find "$DEST" -name 'db-*.sql.gz.gpg' -mmin +120 -delete

echo "$(date -Is) backup ok: $out ($((size / 1024)) KB) from $target"

# Report in to the app so the admin console can show it: the container cannot
# see this directory, and a silent backup job looks exactly like a working one.
docker compose exec -T app python manage.py record_backup --ok --path "$out" --size "$size" --target "$target" >/dev/null 2>&1 || true
local_ok=1

# ── Uploaded files (the media volume) ───────────────────────────────────────
# Photos and documents uploaded through the site live in a Docker volume, not
# in the database, so the dump above does not hold them (owner 2026-11-28).
# Read-only mount, tar inside the postgres image this script already uses (no
# new image to pull), encrypt at once, keep only the ciphertext. A failure here
# never stops the database's off-box copy below; it fails the run at the end.
MEDIA_VOLUME="${BACKUP_MEDIA_VOLUME:-interlaken_media}"
media_enc="$DEST/media-$(date +%F-%H%M).tar.gz.gpg"
media_ok=""
media_error=""
media_files=0
backup_media() {
  if ! docker volume inspect "$MEDIA_VOLUME" >/dev/null 2>&1; then
    media_error="no existe el volumen $MEDIA_VOLUME"; return 1
  fi
  media_plain=$(mktemp "$DEST/.media-XXXXXX.tar.gz")
  if ! docker run --rm -v "$MEDIA_VOLUME":/m:ro postgres:17-alpine \
         tar -C /m -czf - . > "$media_plain"; then
    media_error="no se pudo empaquetar el volumen $MEDIA_VOLUME"; return 1
  fi
  if ! tar -tzf "$media_plain" >/dev/null 2>&1; then
    media_error="el archivo de medios salió dañado"; return 1
  fi
  media_files=$(tar -tzf "$media_plain" | grep -vc '/$' || true)
  local why
  if ! why=$(encrypt_dump "$media_plain" "$media_enc" ./backup-public-key.asc); then
    media_error="no se pudo cifrar el archivo de medios: $why"; return 1
  fi
  rm -f "$media_plain"
  media_plain=""
}
if backup_media; then
  media_ok=1
  media_size=$(stat -c%s "$media_enc")
  # Same retention as the dumps; only ciphertext exists, so only it rotates.
  find "$DEST" -name 'media-*.tar.gz.gpg' -mtime "+$KEEP_DAYS" -delete
  echo "$(date -Is) uploaded files ok: $(basename "$media_enc") ($media_files files, $((media_size / 1024)) KB, encrypted)"
  docker compose exec -T app python manage.py record_backup --media --ok --path "$media_enc" \
    --size "$media_size" --files "$media_files" >/dev/null 2>&1 || true
else
  echo "ERROR: uploaded files not backed up: $media_error" >&2
  rm -f "$media_enc"
  docker compose exec -T app python manage.py record_backup --media --failed \
    --error "$media_error" >/dev/null 2>&1 || true
fi

# ── Off-box copies: ciphertext only ─────────────────────────────────────────
# A backup that only exists on the machine it protects is not a backup.
remote_state=none
[[ -n "${BACKUP_REMOTE:-}" ]] && remote_state=failed
enc="$out.gpg"
if ! why=$(encrypt_dump "$out" "$enc" ./backup-public-key.asc); then
  echo "ERROR: nothing copied off the box, the dump could not be encrypted: $why" >&2
  docker compose exec -T app python manage.py offsite_backup \
    --failed "no se pudo cifrar el respaldo: $why" --remote "$remote_state" </dev/null || true
  exit 1
fi
echo "encrypted for off-box copies: $(basename "$enc") ($(( $(stat -c%s "$enc") / 1024 )) KB)"

# Optional second destination run from the host: an rclone remote
# ("name:bucket/path") or an scp target ("user@host:/path").
if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null && [[ "$BACKUP_REMOTE" == *:* && "$BACKUP_REMOTE" != *@* ]]; then
    if rclone copy "$enc" "$BACKUP_REMOTE"; then remote_state=ok; echo "copied off-box with rclone"; fi
  else
    if scp -q "$enc" "$BACKUP_REMOTE"; then remote_state=ok; echo "copied off-box with scp"; fi
  fi
  [[ "$remote_state" == ok ]] || echo "ERROR: copy to BACKUP_REMOTE failed" >&2
fi

# The dedicated private bucket (BACKUP_S3_*), and the night's off-site outcome
# for the console and the 07:45 check. offsite_backup refuses anything that is
# not ciphertext for the school's key, and never falls back to the media
# bucket. Without BACKUP_S3_* and BACKUP_REMOTE it only notes «sin copia externa».
offsite_failed=""
if ! docker compose exec -T app python manage.py offsite_backup \
       --name "$(basename "$enc")" --remote "$remote_state" < "$enc"; then
  echo "ERROR: off-site copy failed (the local dump is intact)" >&2
  offsite_failed=1
fi

# The uploaded-files ciphertext goes to the same places, recorded on its own
# marker (--kind media). It is already encrypted: nothing else leaves the box.
if [[ -n "$media_ok" ]]; then
  media_remote=none
  if [[ -n "${BACKUP_REMOTE:-}" ]]; then
    media_remote=failed
    if command -v rclone >/dev/null && [[ "$BACKUP_REMOTE" == *:* && "$BACKUP_REMOTE" != *@* ]]; then
      if rclone copy "$media_enc" "$BACKUP_REMOTE"; then media_remote=ok; fi
    else
      if scp -q "$media_enc" "$BACKUP_REMOTE"; then media_remote=ok; fi
    fi
  fi
  if ! docker compose exec -T app python manage.py offsite_backup --kind media \
         --name "$(basename "$media_enc")" --remote "$media_remote" < "$media_enc"; then
    echo "ERROR: off-site copy of the uploaded files failed (the local archive is intact)" >&2
    offsite_failed=1
  fi
fi

[[ -z "$offsite_failed" && -n "$media_ok" ]] || exit 1
