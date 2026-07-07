# Prompt 20 — Deploy to GoDaddy cPanel (Go-Live)

**Run in:** fresh session at `D:\Github\interlaken`, with SSH/cPanel access to the server. **Prereqs:** 02–05 done (and any feature prompts you're shipping). **Reference:** `DEPLOYMENT.md` (whole doc). **Size:** M — mostly ops, executed with the user.

## Context
See `prompts/README.md`. Host = GoDaddy cPanel shared hosting (user `rene82`, domain `interlaken.edu.mx`), Passenger Python app + MySQL + cron. **SSL is currently expired** and blocks HTTPS + Google OAuth + WhatsApp webhooks.

## Goal
Get the app live on `interlaken.edu.mx` with valid TLS, MySQL, working Google login, static React, cron jobs, and real email — following `DEPLOYMENT.md`'s ordered checklist. Guide the user through cPanel-only steps; do the code/config steps directly.

## Tasks (ordered — see DEPLOYMENT.md §7)
1. **SSL first (user, in cPanel):** SSL/TLS → AutoSSL for `interlaken.edu.mx` (+ `www`). Verify HTTPS is green. *Nothing else proceeds until this passes.*
2. **MySQL (user):** create DB + user (e.g. `rene82_interla`); capture credentials.
3. **Python app (user):** Setup Python App → Python 3.11, app root, URL `interlaken.edu.mx`. Confirm it uses `passenger_wsgi.py` (→ production settings).
4. **Code/config (you):** ensure Prompt 02 fixes are present; add `SECURE_PROXY_SSL_HEADER` (done in 02); confirm `requirements.txt` has no Celery/Redis and includes runtime deps (PyMySQL, whitenoise, google libs if bookings). Prepare the **server `.env`** from `DEPLOYMENT.md` §4 (prod ALLOWED_HOSTS/FRONTEND_URL/redirect/DB/SMTP/secrets) — do NOT commit it.
5. **Upload & install:** push `backend/` (git pull on server or upload); `pip install -r requirements.txt` in the cPanel venv; `migrate`; `createsuperuser`.
6. **Frontend build (you):** set Vite `base:'/static/'`, `npm run build`, copy `dist/index.html`→`backend/templates/index.html` and `dist/assets/*`→`backend/static/assets/`, `collectstatic` (whitenoise serves). Verify the SPA + `/admin/` + `/api/v1/...` all load over HTTPS.
7. **Google (user):** add the exact redirect `https://interlaken.edu.mx/auth/google/callback/` in Cloud Console; test login end-to-end.
8. **Cron (user, guided):** add the management-command jobs (`sync_balances`, `sync_purchases`, `low_balance_alerts`, `generate_invoices`, reminders) with the cPanel venv python path.
9. **Email:** point `EMAIL_*` at cPanel SMTP; send a test.
10. **Rotate secrets:** rotate the Google client secret + Loyverse token (exposed earlier); update server `.env` only.
11. **Smoke test:** login (Google + password), a booking, a cafeteria sync, a test payment (sandbox), 404/500 pages, HTTPS redirect, security headers.

## Constraints
- Never commit the server `.env` or any key. Enable HSTS/SSL-redirect only after AutoSSL is green.
- Keep a rollback (DB backup + previous release) before migrating.

## Acceptance / verify
- `https://interlaken.edu.mx` green TLS; home, `/admin/`, `/api/v1/...` all respond; Google login works; cron jobs listed; a test email arrives; Sentry (if enabled) receives a test event.

## Do NOT
- Deploy with expired SSL. Run dev settings in prod. Commit secrets. Skip the pre-migrate backup.
