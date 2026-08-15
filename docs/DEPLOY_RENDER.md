# Deploy free: Render (web) + Supabase (Postgres)

One Render **Docker** web service (free) serves the API **and** the React SPA
(whitenoise); **Supabase** is the free Postgres; **GitHub Actions** runs the
Loyverse sync so balances stay fresh even while the free web service sleeps.

Repo files that make this work: `Dockerfile`, `render.yaml`, `backend/entrypoint.sh`,
`.dockerignore`, `.github/workflows/loyverse-sync.yml`. The Django settings are
already env-driven (DB, hosts, secret) — no code changes needed to switch to Postgres.

---

## 1 · Supabase — create the database
1. **New project** → name it, pick a **region near Mexico** (e.g. `us-east-1`), set a
   strong **database password** and save it.
2. Wait ~2 min for provisioning.
3. **Project Settings → Database → Connection pooler → Session mode** — copy:

   | Field | Value |
   |---|---|
   | Host | `aws-0-<region>.pooler.supabase.com` |
   | Port | `5432` |
   | Database | `postgres` |
   | User | `postgres.<project-ref>` |
   | Password | *(the one you set)* |

   > ⚠️ Use the **pooler** host (IPv4). The "Direct connection" `db.<ref>.supabase.co`
   > is IPv6-only and Render can't reach it.

## 2 · Push the repo
Push the branch you want Render to deploy (these deploy files must be on it).

## 3 · Render — create the web service
1. **New → Blueprint** → connect the GitHub repo → pick the branch → Render reads
   `render.yaml` and proposes the **interlaken** Docker service (free).
2. Fill the env vars it asks for (`sync:false` in the blueprint):
   - `DB_NAME` = `postgres`
   - `DB_USER` = `postgres.<project-ref>`
   - `DB_PASSWORD` = *(Supabase password)*
   - `DB_HOST` = `aws-0-<region>.pooler.supabase.com`
   - **First-deploy admin** (Render free has no shell): `DJANGO_SUPERUSER_EMAIL`,
     `DJANGO_SUPERUSER_PASSWORD`, `DJANGO_SUPERUSER_FIRST_NAME`,
     `DJANGO_SUPERUSER_LAST_NAME`.
   - Leave `ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS` / `CORS_ALLOWED_ORIGINS` /
     `FRONTEND_URL` blank for now (step 4).
3. **Create** → Render builds the image (~6 min) and boots (entrypoint runs
   `migrate` + creates the superuser). Note the assigned URL, e.g.
   `https://interlaken.onrender.com`.

## 4 · Wire the public URL
In the Render service → **Environment**, set (uses the real URL from step 3), which
triggers a redeploy:
```
ALLOWED_HOSTS=interlaken.onrender.com
CSRF_TRUSTED_ORIGINS=https://interlaken.onrender.com
CORS_ALLOWED_ORIGINS=https://interlaken.onrender.com
FRONTEND_URL=https://interlaken.onrender.com
```

## 5 · Verify
- `https://<url>/healthz` → `{"status":"ok","db":true,"cache":true,...}` — this is
  also the blueprint's `healthCheckPath`, so Render only routes traffic once DB +
  cache answer. (`/api/v1/health/` still works for older monitors.)
- `https://<url>/` → the app · `https://<url>/admin/` → log in as the superuser.
- Then **delete the `DJANGO_SUPERUSER_*` env vars** (no longer needed).

## 6 · Load the data
The prod DB starts empty. Populate it against the **prod DB** (run once) — either
locally with the Supabase env exported, or as a one-off `workflow_dispatch` run:
```
python manage.py import_loyverse_students   # roster
python manage.py link_loyverse --commit     # roster ↔ Loyverse
python manage.py sync_balances              # seed opening balances (once)
```

## 7 · Loyverse sync cron (GitHub Actions)
Repo → **Settings → Secrets and variables → Actions → New secret** for each:
`SECRET_KEY` (copy Render's generated one), `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`DB_HOST`, `DB_PORT` (`5432`), `ALLOWED_HOSTS`, `LOYVERSE_API_TOKEN`, and
**`CAFETERIA_SYNC_PURCHASES_SINCE`** = your go-live datetime (ISO-8601). The workflow
then runs every 30 min (edit the cron in the workflow file).

> ⚠️ Set `CAFETERIA_SYNC_PURCHASES_SINCE` **before** the first purchase sync or it
> backfills history and double-debits balances.

## 8 · Google OAuth (when ready)
Google Cloud Console → your OAuth client → **add redirect URI**
`https://<url>/auth/google/callback/`. Set in Render: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://<url>/auth/google/callback/`.

## 9 · Observability & hardening (all optional, no-op until set)

**Sentry (backend)** — set in the Render service environment:

| Var | Meaning |
|---|---|
| `SENTRY_DSN` | Enables the SDK. Unset (default) → Sentry is never even imported. |
| `SENTRY_ENVIRONMENT` | Event environment tag. Falls back to `RENDER_ENV`, then `production`. |
| `SENTRY_RELEASE` | Release tag. Falls back to `GIT_SHA`, then `RENDER_GIT_COMMIT` (Render sets this automatically — so on Render, releases work with zero config). |
| `SENTRY_TRACES_SAMPLE_RATE` | Performance tracing sample rate, `0`–`1`. Default `0` (errors only). |

PII is scrubbed in `before_send` (user email/name/IP, secret-looking headers and
extras) and `send_default_pii=False`.

**Sentry (frontend)** — *build-time* Vite vars (must be present when
`npm run build` runs, i.e. passed as Docker build args if you want them):
`VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_TRACES_SAMPLE_RATE`,
`VITE_GIT_SHA` (release tag). Without `VITE_SENTRY_DSN` the bundle never
initialises Sentry. Source-map upload (`SENTRY_AUTH_TOKEN` + the Sentry Vite
plugin) is deliberately **not** wired into the Docker build; if you later want
readable production stack traces, add `@sentry/vite-plugin` with
`SENTRY_AUTH_TOKEN` as a build secret — until then, events arrive minified.

**Logs** — production logs are JSON lines on stdout (Render's log stream), one
object per record with `ts`, `level`, `logger`, `message` and `request_id`.
Every response carries `X-Request-ID` (inbound ids from a proxy are propagated),
so one request's log lines can be correlated. `LOG_LEVEL` (default `INFO`)
adjusts verbosity.

**Database** — `CONN_MAX_AGE` (default `60`): persistent connections, safe with
the **session-mode** pooler on port 5432 used here. If you ever move to the
transaction-mode pooler (port 6543), set `CONN_MAX_AGE=0` (and
`DISABLE_SERVER_SIDE_CURSORS=True`) — transaction pooling breaks both.

**Rate limiting** — abuse-prone endpoints are throttled (login 10/min/IP, reset
5/h/IP, public forms 5/min/IP, booking 10/min/IP, payment initiation
10/min/user). Counters live in a file cache shared across gunicorn workers;
`RATELIMIT_CACHE_DIR` overrides its location (default `backend/.ratelimit-cache`).
Payment/Loyverse webhooks are signature-verified and not throttled beyond the
pre-existing generous per-IP ceiling, so a provider burst is never dropped.

## 10 · Web push (VAPID) — comunicados on the lock screen

Inert until the keys exist. Generate a VAPID key pair once (either works):

```
npx web-push generate-vapid-keys          # Node
vapid --gen                               # py-vapid CLI (pip install py-vapid)
```

Then set in the Render service **Environment** (backend, runtime):

| Var | Meaning |
|---|---|
| `VAPID_PUBLIC_KEY` | base64url public key — sent to browsers on subscribe. |
| `VAPID_PRIVATE_KEY` | private key — signs every push. Keep secret. |
| `VAPID_ADMIN_EMAIL` | `mailto:` contact required by push services (default `colegio@interlaken.edu.mx`). |

And the **same public key** as `VITE_VAPID_PUBLIC_KEY` — this one is
**build-time** (baked into the SPA bundle): the Dockerfile declares
`ARG VITE_VAPID_PUBLIC_KEY`, and Render passes service env vars to Docker
builds, so setting it in the same Environment tab and redeploying is enough.
Without it the opt-in card never renders.

Flow once configured: parents opt in on the portal dashboard (subscription is
stored per user+device) → publishing a comunicado with **“Enviar notificación
push”** on sends the first batch inline and the `dispatch_notifications` run in
`.github/workflows/scheduled-tasks.yml` drains the rest → taps deep-link to
`/portal/comunicados/<id>` → expired subscriptions (HTTP 404/410) are pruned
automatically on send. Also mirrored in `backend/.env.production.example` and
`frontend/.env.example`.

## Limits to expect (free)
- **Render free sleeps** after ~15 min idle → first hit is a ~30–60s cold start.
  The Actions cron keeps the *data* fresh regardless.
- **Supabase free pauses** after ~1 week with zero DB activity — the 30-min cron
  keeps it awake.
- **Custom domain** (e.g. `colegiointerlaken.…`) — hosting is free; the domain name
  isn't. If you own it (GoDaddy), point a CNAME to Render (free) and add it to
  `ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS`.
- Payments/WhatsApp stay in sandbox until you set their env vars + register the
  webhooks at `https://<url>/api/v1/payments/webhook/...`.
