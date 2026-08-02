#!/usr/bin/env bash
# Render container start: run migrations, then serve. Static was already
# collected at image-build time (see Dockerfile).
set -e

python manage.py migrate --noinput

# Admin bootstrap: idempotently reconcile the superuser declared by the
# DJANGO_SUPERUSER_* env vars (create if missing, else ensure it is an active
# admin). Pointing DJANGO_SUPERUSER_EMAIL at a new address provisions that admin
# on the next deploy — Render free has no persistent shell. Safe every boot; a
# no-op when DJANGO_SUPERUSER_EMAIL is unset.
python manage.py ensure_superuser

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-3}" \
  --timeout 60 \
  --access-logfile - \
  --error-logfile -
