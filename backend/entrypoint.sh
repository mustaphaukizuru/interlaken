#!/usr/bin/env bash
# Render container start: run migrations, then serve. Static was already
# collected at image-build time (see Dockerfile).
set -e

python manage.py migrate --noinput

# One-time admin bootstrap (Render free has no shell): set DJANGO_SUPERUSER_EMAIL,
# _PASSWORD, _FIRST_NAME, _LAST_NAME on the first deploy, then remove them. No-op
# if the user already exists.
if [ -n "${DJANGO_SUPERUSER_PASSWORD:-}" ] && [ -n "${DJANGO_SUPERUSER_EMAIL:-}" ]; then
  python manage.py createsuperuser --noinput 2>/dev/null || true
fi

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-3}" \
  --timeout 60 \
  --access-logfile - \
  --error-logfile -
