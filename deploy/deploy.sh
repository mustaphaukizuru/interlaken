#!/usr/bin/env bash
# Deploy the current master onto the VPS.
#
#   cd /opt/interlaken/deploy && ./deploy.sh
#
# Safe to re-run. Migrations run inside the container at boot (entrypoint.sh),
# so this script does not run them separately.
#
# Exits NON-ZERO if the new version fails to become healthy, and tells you the
# one command that puts the previous version back.
set -euo pipefail

cd "$(dirname "$0")"

fail() { echo "ERROR: $*" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────
[[ -f .env ]] || fail "deploy/.env is missing. Copy env.example to .env and fill it in."

# The file holds the database password and every API secret.
perms="$(stat -c '%a' .env)"
if [[ "$perms" != "600" ]]; then
  echo "  tightening permissions on .env ($perms -> 600)"
  chmod 600 .env
fi

# shellcheck disable=SC1091
set -a; source ./.env; set +a

[[ -n "${PORTAL_DOMAIN:-}" ]] || fail "PORTAL_DOMAIN is not set in .env"
[[ "$PORTAL_DOMAIN" == CHANGEME* ]] && fail "PORTAL_DOMAIN is still the placeholder."
# Caddy exits on an empty email, which would take the site down while compose
# still reported the app container as fine.
[[ -n "${TLS_EMAIL:-}" ]] || fail "TLS_EMAIL is not set in .env (Caddy will not start without it)"
[[ -n "${SECRET_KEY:-}" ]] || fail "SECRET_KEY is not set in .env"

# The database runs on this box now, and compose refuses to interpolate these,
# so an empty one fails mid-deploy with a raw interpolation error. Catch it here
# instead, before anything is rebuilt.
for var in DB_NAME DB_USER DB_PASSWORD; do
  [[ -n "${!var:-}" ]] || fail "$var is not set in .env (the db service needs it; see env.example)"
done

# Say out loud which database this deploy will talk to. The two are one line
# apart in .env, and picking the wrong one shows up as a site that works
# perfectly and is completely empty.
localdb_enabled=false
[[ "${COMPOSE_FILE:-}" == *docker-compose.localdb.yml* ]] && localdb_enabled=true

if [[ -z "${DB_HOST:-}" ]] && ! $localdb_enabled; then
  fail "no database is configured: .env has no DB_HOST and the local-db overlay
       is not enabled. Set DB_HOST to your database host, or add
       COMPOSE_FILE=docker-compose.yml:docker-compose.localdb.yml to .env to run
       Postgres on this box (see env.example)."
fi

if [[ -n "${DB_HOST:-}" && "$DB_HOST" != "db" ]]; then
  echo "  database: EXTERNAL ($DB_HOST) - the local db container will run but go unused."
  echo "            To move the data onto this box, follow 'Moving the data off"
  echo "            Supabase' in docs/DEPLOY_HOSTINGER_VPS.md, then delete DB_HOST"
  echo "            from .env."
else
  echo "  database: local db container (pgdata volume on this box)."
fi

# DNS must already point here or Caddy cannot complete the ACME challenge.
if command -v dig >/dev/null; then
  resolved="$(dig +short "$PORTAL_DOMAIN" | tail -1)"
  [[ -n "$resolved" ]] || echo "  WARNING: $PORTAL_DOMAIN does not resolve yet; the certificate will fail until it does."
fi

# ── Rollback point ──────────────────────────────────────────────────────────
# Tag the currently-running image before rebuilding, so a bad deploy has
# somewhere to go back to. Without this the rebuild plus `image prune` destroys
# the last known-good build.
if docker image inspect interlaken-app:current >/dev/null 2>&1; then
  docker tag interlaken-app:current interlaken-app:previous
fi

echo "==> Fetching latest master"
git -C .. fetch --quiet origin master
BEFORE="$(git -C .. rev-parse HEAD)"
git -C .. checkout --quiet master
git -C .. reset --hard --quiet origin/master
AFTER="$(git -C .. rev-parse HEAD)"
echo "    ${BEFORE:0:8} -> ${AFTER:0:8}"

echo "==> Building image"
docker compose build

# Recreate rather than scale: entrypoint.sh runs `migrate` on every start and
# Django takes no lock, so two containers booting at once can collide on DDL.
# One container at a time is the correct trade for a school-sized deployment.
echo "==> Restarting application"
docker compose up -d --force-recreate app

# Caddy too: a Caddyfile edit that arrived with this commit is mounted read-only
# into the container and does NOT apply until Caddy reloads.
echo "==> Reloading Caddy"
docker compose up -d caddy
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
  || docker compose restart caddy

echo "==> Waiting for health"
healthy=false
for _ in $(seq 1 40); do
  status="$(docker inspect --format '{{.State.Health.Status}}' \
            "$(docker compose ps -q app)" 2>/dev/null || echo starting)"
  if [[ "$status" == "healthy" ]]; then healthy=true; break; fi
  if [[ "$status" == "unhealthy" ]]; then break; fi
  sleep 5
done

if [[ "$healthy" != true ]]; then
  echo "" >&2
  echo "DEPLOY FAILED: the container never became healthy. Recent logs:" >&2
  docker compose logs --tail 40 app >&2
  # The app's own log usually only says it cannot reach the database; the
  # reason is in the database's log, so print both rather than sending you
  # looking for the second command yourself.
  echo "" >&2
  echo "Database logs (the app cannot start without it):" >&2
  docker compose logs --tail 20 db >&2
  echo "" >&2
  echo "If these say password authentication failed: DB_PASSWORD in .env is" >&2
  echo "only used when the volume is FIRST created. Change it inside the" >&2
  echo "database instead:" >&2
  echo "  docker compose exec db psql -U $DB_USER -d $DB_NAME -c \"ALTER USER $DB_USER WITH PASSWORD '<the value in .env>';\"" >&2
  echo "" >&2
  echo "To roll back to the previous image:" >&2
  echo "  docker tag interlaken-app:previous interlaken-app:current && docker compose up -d --force-recreate app" >&2
  exit 1
fi
echo "    healthy"

# Keep this build as the rollback point for next time.
docker tag "$(docker compose images -q app)" interlaken-app:current

echo "==> Reclaiming disk (dangling layers only; tagged rollback image is kept)"
docker image prune -f >/dev/null

echo "==> Live check"
code="$(curl -sS -o /dev/null -w '%{http_code}' "https://${PORTAL_DOMAIN}/healthz" || echo 000)"
echo "    https://${PORTAL_DOMAIN}/healthz -> ${code}"
[[ "$code" == "200" ]] || fail "the site did not answer 200 from the outside (check DNS and 'docker compose logs caddy')"
echo "==> Done."
