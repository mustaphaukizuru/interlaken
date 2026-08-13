# syntax=docker/dockerfile:1
# Single-image deploy (Render): build the Vite SPA, serve it + the API from one
# Django/gunicorn process (whitenoise for static). Build context = repo root.

# ── Stage 1: build the React SPA (Vite base=/static/) ───────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
# node:20-slim ships npm 10.8.2, which generates/validates a lock inconsistently
# for this dependency graph (ajv/json-schema-traverse split) and fails `npm ci`
# with EUSAGE. Pin a newer npm that resolves it (the committed lock is generated
# with the same version), so the Render build stops failing.
RUN npm install -g npm@11.19.0 && npm ci
COPY frontend/ ./
RUN npm run build   # → frontend/dist (assets reference /static/)

# ── Stage 2: Django + gunicorn ──────────────────────────────────────────────
FROM python:3.12-slim AS backend
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=config.settings.production
WORKDIR /app/backend

COPY backend/requirements.txt ./
# libpq5 is the only native runtime dep (psycopg2). The MySQL toolchain that
# used to be installed here just to compile mysqlclient is gone with the driver.
# There is now NO C compiler in this image: every dependency must ship a
# manylinux wheel (cryptography, Pillow, psycopg2-binary do) or be pure Python
# (http-ece, the one sdist, is). Adding a dependency that compiles C means
# re-adding build-essential here, or the Render build fails.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq5 \
 && pip install -r requirements.txt \
 && rm -rf /var/lib/apt/lists/*

COPY backend/ ./

# Wire the built SPA into Django: index.html is a template (the SPA catch-all
# renders it); everything else is static (assets, sw.js, manifest, icons).
COPY --from=frontend /app/frontend/dist/index.html ./templates/index.html
COPY --from=frontend /app/frontend/dist/ ./static/
RUN rm -f ./static/index.html

# Collect + hash static at build time (whitenoise manifest). No DB is touched;
# throwaway env just lets settings import.
RUN SECRET_KEY=build-only \
    DB_ENGINE=django.db.backends.sqlite3 DB_NAME=/tmp/build.sqlite3 \
    ALLOWED_HOSTS=localhost \
    python manage.py collectstatic --noinput

RUN chmod +x ./entrypoint.sh
EXPOSE 8000
CMD ["./entrypoint.sh"]
