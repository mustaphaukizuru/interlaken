#!/usr/bin/env bash
# One-shot move of the database from the external host named in .env onto this
# box, with the checks that matter done for you.
#
#   cd /opt/interlaken/deploy && ./migrate-from-external-db.sh
#
# Every step is rehearsed in CI-adjacent conditions (see the runbook in
# docs/DEPLOY_HOSTINGER_VPS.md), and the whole thing is reversible until the
# very last step, which you do by hand: the external database is only ever READ.
#
# What it does:
#   1. refuses unless .env still points at an external database
#   2. refuses if the local database already holds data (unless --force)
#   3. stops the app so nothing writes to the external database mid-copy
#   4. records row counts at the SOURCE, then dumps it
#   5. restores into the local container and compares the counts
#   6. tells you the one line to delete to make the switch
set -euo pipefail
cd "$(dirname "$0")"

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

fail() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

[[ -f .env ]] || fail "deploy/.env is missing."
# shellcheck disable=SC1091
set -a; source ./.env; set +a

: "${DB_NAME:?DB_NAME not set in .env}"
: "${DB_USER:?DB_USER not set in .env}"
: "${DB_PASSWORD:?DB_PASSWORD not set in .env}"

if [[ -z "${DB_HOST:-}" || "$DB_HOST" == "db" ]]; then
  fail "DB_HOST is not set to an external host, so there is nothing to move.
       (If you have already migrated, you are done — deploy.sh will say
       'database: local db container'.)"
fi

# The credentials in .env belong to the EXTERNAL database right now. The local
# container is created with the same ones, which keeps the app config identical
# either side of the switch.
SRC_HOST="$DB_HOST"; SRC_PORT="${DB_PORT:-5432}"
STAMP="$(date +%F-%H%M%S)"
DUMP="/root/interlaken-migration-$STAMP.sql.gz"
COUNT_SQL="SELECT 'accounts_user='       || (SELECT count(*) FROM accounts_user)
        || ' studentprofile='            || (SELECT count(*) FROM accounts_studentprofile)
        || ' cafeteria_tx='              || (SELECT count(*) FROM cafeteria_cafeteriatransaction)
        || ' payments='                  || (SELECT count(*) FROM payments_payment)
        || ' announcements='             || (SELECT count(*) FROM portal_announcement);"

echo "This will copy:"
echo "    from  $SRC_HOST:$SRC_PORT/$DB_NAME   (read-only; never modified)"
echo "    into  the local db container on this box"
echo
read -r -p "Type MIGRATE to continue: " answer
[[ "$answer" == "MIGRATE" ]] || fail "aborted."

step "Checking the local database is empty"
docker compose -f docker-compose.yml -f docker-compose.localdb.yml up -d db >/dev/null
for _ in $(seq 1 30); do
  docker compose -f docker-compose.yml -f docker-compose.localdb.yml exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" -q && break
  sleep 2
done
local_tables=$(docker compose -f docker-compose.yml -f docker-compose.localdb.yml exec -T db psql -tA -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '[:space:]')
if [[ "$local_tables" != "0" ]] && ! $FORCE; then
  fail "the local database already has $local_tables tables. Re-run with --force
       to overwrite it (the dump is restored with --clean --if-exists)."
fi

step "Reading row counts from the source"
SRC_COUNTS=$(docker run --rm -e PGPASSWORD="$DB_PASSWORD" postgres:17-alpine \
  psql -tA -h "$SRC_HOST" -p "$SRC_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$COUNT_SQL" | tr -d '\r')
echo "    $SRC_COUNTS"

step "Stopping the app so nothing writes during the copy"
docker compose stop app >/dev/null 2>&1 || true
echo "    stopped (the site is down from here until the last step)"

step "Dumping the source database"
docker run --rm -e PGPASSWORD="$DB_PASSWORD" postgres:17-alpine \
  pg_dump --no-owner --no-privileges --clean --if-exists --schema=public \
          -h "$SRC_HOST" -p "$SRC_PORT" -U "$DB_USER" -d "$DB_NAME" \
  | gzip > "$DUMP"
gunzip -t "$DUMP" || fail "the dump is not a valid gzip file. Nothing was changed."
size=$(stat -c%s "$DUMP")
(( size > 10240 )) || fail "the dump is only ${size}B, which cannot be right. Nothing was changed."
echo "    $DUMP ($((size / 1024)) KB)"

step "Restoring into the local database"
gunzip -c "$DUMP" | docker compose -f docker-compose.yml -f docker-compose.localdb.yml exec -T db psql -q -U "$DB_USER" -d "$DB_NAME"

step "Comparing row counts"
DST_COUNTS=$(docker compose -f docker-compose.yml -f docker-compose.localdb.yml exec -T db psql -tA -U "$DB_USER" -d "$DB_NAME" -c "$COUNT_SQL" | tr -d '\r')
echo "    source: $SRC_COUNTS"
echo "    local : $DST_COUNTS"
if [[ "$SRC_COUNTS" != "$DST_COUNTS" ]]; then
  docker compose start app >/dev/null 2>&1 || true
  fail "the counts do not match. The app has been restarted against the EXTERNAL
       database, so nothing is lost — investigate before trying again.
       The dump is kept at $DUMP."
fi
echo "    identical"

cat <<EOF

The copy is done and verified, and the site is still configured to read the
external database. One line makes the switch:

    echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.localdb.yml' >> .env
    sed -i '/^DB_HOST=/d;/^DB_PORT=/d;/^DB_SSLMODE=/d' .env
    ./deploy.sh          # must print: database: local db container
    ./backup-db.sh       # first local backup, straight away

Keep the external database for about a week: putting DB_HOST back and
redeploying is the whole rollback. The dump stays at:
    $DUMP
EOF
