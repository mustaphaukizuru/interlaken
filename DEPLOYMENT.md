# Colegio Interlaken — Deployment & Infrastructure Alignment

**Generated:** 2026-07-07 · Host: **GoDaddy cPanel shared hosting** (Jupiter, cPanel 134.0.43)
Companion to [STATUS_REPORT.md](STATUS_REPORT.md), [CAFETERIA_WALLET_SPEC.md](CAFETERIA_WALLET_SPEC.md), [BOOKING_CALENDAR_SPEC.md](BOOKING_CALENDAR_SPEC.md)

## 0. Server facts (from cPanel)
- **cPanel user:** `rene82` · **Home:** `/home/rene82` · **Docroot:** `/home/rene82/public_html`
- **Primary domain:** `interlaken.edu.mx` · **Dedicated IP:** 107.180.58.214
- Multi-domain account (also hosts interlaken.com.mx, colegiointerlaken.edu.mx, ninoscantores.com, rademasa.com, sofe.mx, mamasinrecetas.com…)
- Available: **Setup Python App (Passenger)**, **MySQL / phpMyAdmin**, **Cron jobs**, **SSH**, **Git Version Control**, **SSL/TLS**, 2 email accounts, PHP/Ruby selectors.
- **Disk:** 1.04 GB used, DB 6.19 MB. Plenty of headroom.

---

## 1. 🔴 URGENT — SSL certificate is EXPIRED

cPanel shows **"Certificado SSL: Expired — Your domain is at risk!"** Consequences:
- HTTPS is broken for `interlaken.edu.mx` right now.
- **Google OAuth will fail** — the registered redirect is `https://interlaken.edu.mx/auth/google/callback`; Google refuses non-valid-TLS callbacks.
- `production.py` sets `SECURE_SSL_REDIRECT=True` + HSTS → with a bad cert the site becomes unreachable/untrusted.

**Fix first:** cPanel → **SSL/TLS** → run **AutoSSL** (Let's Encrypt) for `interlaken.edu.mx` (+ `www`). Verify `https://interlaken.edu.mx` is green before touching OAuth. Nothing else in this doc works until this is green.

---

## 2. Deployment architecture (how the app maps to this host)

```
interlaken.edu.mx  (Passenger Python App)
  └─ /home/rene82/<app_root>/            ← Django project (backend/)
       passenger_wsgi.py  → config.settings.production   ✅ already correct
       config/, apps/, requirements.txt, .env (prod)
       static/  templates/index.html     ← built React SPA lands here
  Apache/Passenger routes the whole domain to the WSGI app.
  whitenoise serves /static/ from inside the app (already configured).
```

- **Passenger:** `backend/passenger_wsgi.py` already pins `config.settings.production` and adds the project root to `sys.path`. ✅ Aligned. Create the app via cPanel **Setup Python App** (Application root = where you upload `backend/`, Application URL = `interlaken.edu.mx`, Python **3.11**). cPanel generates its own virtualenv — **do not** use the committed `backend/venv/` (it's the wrong platform and must be removed from git anyway — see STATUS_REPORT §7).
- **MySQL:** already the production DB engine (`base.py`), using **PyMySQL** (no `mysqlclient` compile needed — correct choice for shared hosting). ⚠️ **Create the DB in cPanel** (name/user will be prefixed `rene82_…`, e.g. `rene82_interla`) and update prod `.env` to match — the current `.env` values (`interla2_interla` / `interlaken2`) look like a *different* account's naming and won't exist under `rene82`.
- **Static + React:** the SPA catch-all serves `templates/index.html`, which doesn't exist yet (STATUS_REPORT §5). Deploy step: build the frontend and place the output where Django serves it (§5 below).
- **Email:** switch Django off the console backend to **cPanel SMTP** (`mail.interlaken.edu.mx`, one of the 2 mailboxes) so notifications/confirmations actually send. `base.py` already reads `EMAIL_HOST/PORT/USER/PASSWORD` from env — just set them.

---

## 3. ⚠️ Background jobs: cron, NOT Celery/Redis

Shared cPanel hosting has **no Redis and no persistent worker processes**, so the Celery/Redis design assumed in the cafeteria spec **won't run here**. Use **cPanel Cron jobs** calling Django **management commands** instead:

| Job | Command | Suggested cron |
|---|---|---|
| Sync cafeteria balances | `python manage.py sync_balances` | every 10 min |
| Poll Loyverse purchases → notify | `python manage.py sync_purchases` | every 5 min |
| Low-balance alerts | `python manage.py low_balance_alerts` | daily 07:00 |
| Booking reminders | `python manage.py send_booking_reminders` | daily 08:00 |

Each cron entry activates the cPanel venv then runs the command, e.g.:
`/home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py sync_balances`

**Exact cPanel crontab lines** (Cron Jobs → *Add New Cron Job*). Adjust `<app>` to the
Application root and confirm the venv path in cPanel → *Setup Python App*. `manage.py`
defaults to production settings via `passenger_wsgi`; pin it explicitly for cron so the
environment is unambiguous:

```cron
# m  h  dom mon dow   command
*/10 *  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py sync_balances >> /home/rene82/logs/cafeteria.log 2>&1
*/5  *  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py sync_purchases >> /home/rene82/logs/cafeteria.log 2>&1
0    7  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py low_balance_alerts >> /home/rene82/logs/cafeteria.log 2>&1
0    8  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py send_booking_reminders >> /home/rene82/logs/bookings.log 2>&1
```

- `sync_purchases` is a **placeholder until Prompt 09** (logs a notice, processes nothing) — the cron line is valid now and starts working once the pipeline ships.
- `low_balance_alerts` self-dedups (7-day cooldown, cleared on recovery), so a daily schedule won't spam parents; add `--force` only for a manual one-off sweep.
- `mkdir -p /home/rene82/logs` once so the redirect targets exist.

> This **supersedes** the Celery/Redis references in `CAFETERIA_WALLET_SPEC.md` §7 R6. Remove `celery`, `redis`, `django-celery-beat` from `requirements.txt` (dead weight on this host). Real-time paths (Loyverse/WhatsApp/payment webhooks) are just HTTPS endpoints and work fine under Passenger.

---

## 4. Google OAuth — production configuration

Your `client_secret_…json` (Web OAuth client, project `interlaken-project`) declares:
`redirect_uris: ["https://interlaken.edu.mx/auth/google/callback"]`

**Two things to reconcile:**
1. **Trailing-slash mismatch** — your Django route is `/auth/google/callback/` (with slash, `accounts/urls.py:6`) but Google has it **without** a slash. Google requires an **exact** match. **Fix:** in Google Cloud Console → Credentials → this OAuth client → Authorized redirect URIs, add the exact value **`https://interlaken.edu.mx/auth/google/callback/`** (keep the no-slash one too). Then set `GOOGLE_REDIRECT_URI` to the slash version so what the app sends === what's registered.
2. **The P0 settings bug still applies** (STATUS_REPORT §4.1): `base.py` never defines `GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / FRONTEND_URL`. Add them (reading from env).

**Production `.env` (on the server) should set:**
```
DEBUG=False
ALLOWED_HOSTS=interlaken.edu.mx,www.interlaken.edu.mx      # ← currently MISSING the .edu.mx host
FRONTEND_URL=https://interlaken.edu.mx
GOOGLE_REDIRECT_URI=https://interlaken.edu.mx/auth/google/callback/
GOOGLE_CLIENT_ID=…        # from the JSON
GOOGLE_CLIENT_SECRET=…    # from the JSON (keep secret)
CORS_ALLOWED_ORIGINS=https://interlaken.edu.mx
# cPanel SMTP
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=mail.interlaken.edu.mx
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=…@interlaken.edu.mx
EMAIL_HOST_PASSWORD=…
# MySQL (match the DB you create in cPanel)
DB_NAME=rene82_interla
DB_USER=rene82_interla
DB_PASSWORD=…
```
Keep your **local** `.env` on SQLite/localhost as-is — these are the **prod** values, which live only in the server's `.env`.

> **Since the frontend is served same-origin** (§5), the SPA calls `/api/v1/...` and `/auth/...` on `interlaken.edu.mx` directly — so the frontend `VITE_*` base can be empty/relative, which also sidesteps the env-var-name bug in STATUS_REPORT §4.3.

---

## 5. Building & serving the React SPA on this host

The frontend is Vite → static files (no Node process needed at runtime). Recommended: **serve it from Django** so there's one app, one domain, one TLS cert.

1. Set Vite `base: '/static/'` (so asset URLs resolve under Django static).
2. `npm run build` → produces `dist/index.html` + `dist/assets/*`.
3. Copy `dist/index.html` → `backend/templates/index.html`; copy `dist/assets/*` → `backend/static/assets/`.
4. `python manage.py collectstatic` (whitenoise serves them, already configured).
5. The existing SPA catch-all (`core/urls.py`) then serves `index.html` for all non-API routes. ✅

Automate steps 2–4 in a `deploy` script or a management command. (Alternative: drop `dist/` straight into `public_html` and route `/api`,`/auth`,`/admin`,`/static` to Passenger via `.htaccess` — more moving parts; not recommended.)

---

## 6. Security / hygiene alignment

- 🔐 **Rotate exposed secrets before go-live.** The Google `client_secret` and Loyverse token have appeared in plaintext (chat, `CLAUDE.md`). `.env` and the JSON are **not** committed (verified), which is good — but rotate the Google secret in Cloud Console and the Loyverse token once, then store only in the server `.env`.
- Remove `backend/venv/` and `db.sqlite3-journal` from git (STATUS_REPORT §7) — cPanel builds its own venv; the committed one is dead weight and platform-wrong.
- Keep `production.py`'s HSTS/SSL-redirect — but **only after** AutoSSL is green (else the site locks itself out).
- Add `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO','https')` to `production.py` — behind Passenger/Apache, `SECURE_SSL_REDIRECT` can otherwise loop.
- Confirm the P1 security fixes (admissions IDOR, payment/Loyverse/WhatsApp webhook signatures) before exposing those endpoints publicly.

---

## 7. Go-live checklist (ordered)

1. **cPanel → SSL/TLS → AutoSSL** for interlaken.edu.mx → verify HTTPS green. *(unblocks everything)*
2. cPanel → **MySQL** → create DB `rene82_interla` + user; note credentials.
3. cPanel → **Setup Python App** → Python 3.11, app root, URL = interlaken.edu.mx.
4. Apply code fixes: `GOOGLE_*`/`FRONTEND_URL` settings, `token/` login route, ALLOWED_HOSTS, `SECURE_PROXY_SSL_HEADER`, drop Celery/Redis.
5. Upload `backend/`, create server `.env` (§4 values), `pip install -r requirements.txt` in the cPanel venv.
6. `migrate`, `createsuperuser`, build+collect React (§5).
7. Google Cloud Console → add the slash redirect URI; verify login end-to-end.
8. Set cron jobs (§3). Switch email to SMTP; send a test.
9. Rotate secrets (§6).
