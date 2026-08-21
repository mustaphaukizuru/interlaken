#!/usr/bin/env bash
# Container start: run migrations, then serve. Static was already
# collected at image-build time (see Dockerfile).
set -e

python manage.py migrate --noinput

# Admin bootstrap: idempotently reconcile the superuser declared by the
# DJANGO_SUPERUSER_* env vars (create if missing, else ensure it is an active
# admin). Pointing DJANGO_SUPERUSER_EMAIL at a new address provisions that admin
# on the next deploy, without needing a shell on the box. Safe every boot; a
# no-op when DJANGO_SUPERUSER_EMAIL is unset.
python manage.py ensure_superuser

# The Loyverse webhook carries its shared secret in the URL PATH, and an
# access log records the request line, so behind a proxy that already logs
# access this is a second cleartext copy of a live credential sitting in
# the container log. Set GUNICORN_ACCESS_LOG=none there. Default unchanged.
access_log="${GUNICORN_ACCESS_LOG:--}"
if [ "$access_log" = "none" ]; then
  access_log=/dev/null
fi

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-3}" \
  --timeout 60 \
  --access-logfile "$access_log" \
  --error-logfile -
