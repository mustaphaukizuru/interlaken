#!/usr/bin/env bash
# Restore drill / real restore for the Interlaken database (BACKLOG P5-2).
#
#   ./restore-db.sh <dump.sql.gz>               # DRILL: restore into a scratch DB, print counts, drop it
#   ./restore-db.sh <dump.sql.gz> --into-live   # REAL restore into $DB_NAME (asks you to type RESTAURAR)
#
# Works against the compose `db` service or an external DB_HOST exactly like
# backup-db.sh. The drill never touches the live database: it creates
# "<DB_NAME>_restore_<timestamp>", loads the dump, counts users / students /
# ledger rows, and drops it. Run it monthly (crontab.example) so the backups are
# proven restorable, not just present.
set -euo pipefail
cd "$(dirname "$0")"
dump="${1:-}"
mode="${2:-drill}"
[[ -f "$dump" ]] || { echo "uso: $0 <dump.sql.gz> [--into-live]" >&2; exit 2; }
set -a; # shellcheck disable=SC1091
source .env; set +a
: "${DB_NAME:?DB_NAME missing in .env}"; : "${DB_USER:?}"; : "${DB_PASSWORD:?}"

psql_cmd() {
  if [[ -n "${DB_HOST:-}" && "$DB_HOST" != "db" ]]; then
    docker run --rm -i -e PGPASSWORD="$DB_PASSWORD" postgres:17-alpine psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" "$@"
  else
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$DB_USER" "$@"
  fi
}

# backup-db.sh dumps --schema=public only, so the dump has no CREATE EXTENSION for
# the extensions installed IN public (core/migrations/0004_pg_extensions.py).
# Objects in the dump need them (immutable_unaccent, gin_trgm_ops indexes): without
# this a fresh database fails on "public.unaccent does not exist", and a live
# restore fails on DROP SCHEMA public (the extensions still depend on it). The
# dump's --clean drops every dependent first, so plain DROP EXTENSION is enough.
dump_sql() {
  gunzip -c "$1" | sed \
    -e 's/^DROP SCHEMA IF EXISTS public;$/DROP EXTENSION IF EXISTS unaccent, pg_trgm;\n&/' \
    -e 's/^CREATE SCHEMA public;$/&\nCREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;\nCREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;/'
}

counts() {
  psql_cmd -d "$1" -At -c "select 'users', count(*) from accounts_user union all select 'students', count(*) from accounts_studentprofile union all select 'ledger', count(*) from cafeteria_cafeteriatransaction union all select 'pages', count(*) from content_page;"
}

if [[ "$mode" == "--into-live" ]]; then
  echo "Esto REEMPLAZA la base $DB_NAME con $dump. Tome un respaldo fresco primero (./backup-db.sh)."
  read -r -p "Escriba RESTAURAR para continuar: " ok
  [[ "$ok" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }
  docker compose stop app >/dev/null
  dump_sql "$dump" | psql_cmd -d "$DB_NAME" >/dev/null
  docker compose start app >/dev/null
  echo "Restaurado. Conteos:"; counts "$DB_NAME"
  exit 0
fi

scratch="${DB_NAME}_restore_$(date +%Y%m%d%H%M%S)"
echo "Simulacro: restaurando $dump en $scratch (la base viva no se toca)"
psql_cmd -d postgres -c "create database \"$scratch\";" >/dev/null
# WITH (FORCE): the Supabase pooler keeps its server connection to the scratch
# database open after psql exits, so a plain DROP fails and copies pile up.
drop_scratch() {
  for _ in 1 2 3; do
    psql_cmd -d postgres -c "drop database if exists \"$scratch\" with (force);" >/dev/null && { echo "Base de prueba eliminada."; return 0; }
    sleep 10
  done
  echo "AVISO: no se pudo eliminar $scratch; bórrela a mano." >&2
}
trap drop_scratch EXIT
dump_sql "$dump" | psql_cmd -d "$scratch" >/dev/null
echo "OK: el respaldo se restaura. Conteos en la copia:"
counts "$scratch"
echo "Conteos en la base viva (para comparar):"
counts "$DB_NAME" || true
