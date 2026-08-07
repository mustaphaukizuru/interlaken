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
| Seed opening cafeteria balances | `python manage.py sync_balances` | every 5 min |
| Poll Loyverse purchases → notify | `python manage.py sync_purchases` | **every 1 min** |
| One-shot full Loyverse refresh | `python manage.py refresh_loyverse` | on demand / after go-live |
| Low-balance alerts | `python manage.py low_balance_alerts` | daily 07:00 |
| Booking reminders | `python manage.py send_booking_reminders` | daily 08:00 |
| Retry booking → Calendar events | `python manage.py sync_calendar` | every 15 min |
| Generate monthly tuition invoices | `python manage.py generate_invoices` | monthly, 1st 06:00 |
| Apply tuition late fees | `python manage.py apply_late_fees` | daily 06:30 |
| Tuition payment reminders | `python manage.py send_payment_reminders` | daily 07:30 |
| **Database backup (+rotation)** | `python manage.py backup_database` | daily 02:30 |

Each cron entry activates the cPanel venv then runs the command, e.g.:
`/home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py sync_balances`

**Exact cPanel crontab lines** (Cron Jobs → *Add New Cron Job*). Adjust `<app>` to the
Application root and confirm the venv path in cPanel → *Setup Python App*. `manage.py`
defaults to production settings via `passenger_wsgi`; pin it explicitly for cron so the
environment is unambiguous:

```cron
# m  h  dom mon dow   command
# Cafeteria — keep purchases near real-time (1 min) so parents see POS spend fast.
*/5  *  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py sync_balances --no-profiles >> /home/rene82/logs/cafeteria.log 2>&1
*    *  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py sync_purchases >> /home/rene82/logs/cafeteria.log 2>&1
0    7  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py low_balance_alerts >> /home/rene82/logs/cafeteria.log 2>&1
0    8  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py send_booking_reminders >> /home/rene82/logs/bookings.log 2>&1
*/15 *  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py sync_calendar >> /home/rene82/logs/bookings.log 2>&1
0    6  1   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py generate_invoices >> /home/rene82/logs/finance.log 2>&1
30   6  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py apply_late_fees >> /home/rene82/logs/finance.log 2>&1
30   7  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py send_payment_reminders >> /home/rene82/logs/finance.log 2>&1
30   2  *   *   *   DJANGO_SETTINGS_MODULE=config.settings.production /home/rene82/virtualenv/<app>/3.11/bin/python /home/rene82/<app>/manage.py backup_database --output-dir /home/rene82/backups >> /home/rene82/logs/backup.log 2>&1
```

> **Go-live tip:** after linking the Loyverse token, run once:
> `python manage.py refresh_loyverse --import-students`
> Then rely on the 1-min `sync_purchases` cron. Parents can also hit **Actualizar**
> in `/portal/cafeteria` to force an immediate Loyverse poll (rate-limited).

- `sync_balances` **seeds each newly-linked student's OPENING balance** from Loyverse points, then never touches it again — the local `CafeteriaBalance` is the source of truth (spec R1: Loyverse `total_points` can't be written, so online top-ups live only in our ledger). Already-seeded students are a no-op, so a 10-min schedule is safe and won't clobber top-ups/adjustments. Onboarding order matters: **seed before purchases start syncing.** Online top-ups create ledger↔Loyverse drift (money we can't push to Loyverse) — run `reconcile` to see it, and staff load that amount into the Loyverse POS manually so the child can spend it. This command also **self-throttles a full Loyverse profile refresh** (visit history + lifetime spend → `LoyverseProfile`) at most ~once/day, so no separate cron entry is needed; pass `--no-profiles` to skip it. (The standalone `sync_loyverse_profiles --commit` does the same on demand.)
- `sync_purchases` (Prompt 09) polls Loyverse receipts, idempotently records each new purchase (unique `loyverse_receipt_id`), debits the local balance, and notifies every linked parent (in-app + email); a purchase that crosses the low-balance threshold triggers a deduped alert. Safe to run every 5 min — re-runs never duplicate or re-notify. **⚠️ Before scheduling this cron, set `CAFETERIA_SYNC_PURCHASES_SINCE` to your go-live datetime** (ISO-8601). The first run must not backfill history: opening balances were seeded from Loyverse points, which already include past spend, so replaying old receipts would double-debit. With no watermark the first run starts from "now".
- `low_balance_alerts` self-dedups (7-day cooldown, cleared on recovery), so a daily schedule won't spam parents; add `--force` only for a manual one-off sweep.
- `sync_calendar` (Prompt 13) retries Google Calendar creation for active bookings whose event failed at booking time (empty `google_event_id`), and clears events left on cancelled bookings. It's a **clean no-op** when calendar is unconfigured, so it's safe to schedule unconditionally. Requires the §8 service-account setup to actually create events.
- `send_booking_reminders` emails a **day-before reminder** (with the `.ics` invite) to every family whose visit is **tomorrow** and who hasn't been reminded. **Idempotent** via `Booking.reminder_sent`, and only active bookings (pending/confirmed) are reminded, so a daily 08:00 schedule never double-sends. `--dry-run` previews; `--date YYYY-MM-DD` targets a specific day.
- `generate_invoices` (Prompt 17) mints one tuition invoice per active student for the current month from the matching `FeeSchedule` (applying sibling/beca discounts). **Idempotent per `(student, period)`** — a re-run creates nothing new. Pass `--period YYYY-MM` to backfill a specific month.
- `apply_late_fees` (Prompt 17) charges a one-time late fee (per the invoice's `FeeSchedule` rule) on overdue unpaid invoices past their grace window and flips them to *overdue*. **Idempotent** (`Invoice.late_fee_applied`) — safe to run daily.
- `send_payment_reminders` (Prompt 17) emails/notifies parents before the due date and after an invoice is overdue; each reminder is **deduped per invoice**, so a daily schedule won't spam. Windows tuned via `TUITION_REMINDER_BEFORE_DAYS` / `TUITION_REMINDER_OVERDUE_DAYS`.
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
2. cPanel → **MySQL** → create DB `rene82_interla` + user; note credentials. **⚠️ Load the MySQL time-zone tables** — see the *Timezone tables* note after step 10; without them the staff dashboard reads all zeros.
3. cPanel → **Setup Python App** → Python 3.11, app root, URL = interlaken.edu.mx.
4. Apply code fixes: `GOOGLE_*`/`FRONTEND_URL` settings, `token/` login route, ALLOWED_HOSTS, `SECURE_PROXY_SSL_HEADER`, drop Celery/Redis.
5. Upload `backend/`, create server `.env` (§4 values), `pip install -r requirements.txt` in the cPanel venv.
6. `migrate`, `createsuperuser`, build+collect React (§5).
7. Google Cloud Console → add the slash redirect URI; verify login end-to-end.
8. Set cron jobs (§3). Switch email to SMTP; send a test.
9. Configure Google Calendar service account (§8) so confirmed bookings create events.
10. Rotate secrets (§6).

> **⚠️ Timezone tables (MySQL) — required, easy to miss.** The app runs
> `USE_TZ=True` with `TIME_ZONE='America/Mexico_City'`, so every date-bucketed
> query the staff dashboard issues (`TruncDate`, `completed_at__date`, the daily
> series → MySQL `CONVERT_TZ(col,'UTC','America/Mexico_City')`) depends on the
> server's **named** time-zone tables being loaded. If they're missing,
> `CONVERT_TZ` returns **NULL** and the day series, month-to-date payments and
> admissions trend all silently read as **zero** — the dashboard looks "empty"
> with a full database. Verify on the prod DB:
>
> ```sql
> SELECT CONVERT_TZ(NOW(), 'UTC', 'America/Mexico_City');  -- NULL ⇒ tables missing
> ```
>
> Load them once (needs write access to the `mysql` system DB):
>
> ```bash
> mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql -u root mysql
> ```
>
> On shared hosting where you can't write to the `mysql` DB yourself, ask
> GoDaddy support to load the zoneinfo tables (a standard, server-wide request —
> not per-database). The `SELECT` above is the go/no-go check; re-run it after.

---

## 8. Google Calendar for bookings (service account) — Prompt 13

Confirmed bookings create an event on the **school's Google Calendar** and invite
the parent. This runs server-side with a **service account** — NOT the OAuth login
client (`client_secret_…json`), which cannot write calendar events. Setup is
entirely in the GCP Console + cPanel; **no key is ever committed to git**.

**One-time GCP setup (project `interlaken-project`):**
1. **APIs & Services → Library → enable "Google Calendar API"**.
2. **APIs & Services → Credentials → Create credentials → Service account**
   (e.g. `interlaken-calendar`). No project roles are needed.
3. On the new service account → **Keys → Add key → Create new key → JSON**.
   Download it. This is the file the app reads — keep it secret.
4. **Share the school calendar with the service account.** Google Calendar (web) →
   the school calendar → *Settings and sharing* → *Share with specific people* →
   add the service account's email (`…@interlaken-project.iam.gserviceaccount.com`)
   with **"Make changes to events"**.
5. Copy the calendar's **Calendar ID** (Settings → *Integrate calendar* →
   `…@group.calendar.google.com`, or your primary address).

**Upload the key & set env (server only):**
- Place the JSON somewhere outside the docroot and out of git, e.g.
  `/home/rene82/secrets/interlaken-calendar.json` (`chmod 600`).
- Add to the production `.env`:
  ```
  GOOGLE_CALENDAR_ID=<calendar id>@group.calendar.google.com
  GOOGLE_CALENDAR_SA_KEY=/home/rene82/secrets/interlaken-calendar.json
  ```
- `pip install -r requirements.txt` pulls `google-api-python-client` + `google-auth`.

**Behaviour / guarantees:**
- Both env values set + key readable → a confirmed booking creates a calendar event
  and (via `sendUpdates='all'`) Google emails the parent an invite; cancelling a
  booking deletes the event. Our own branded confirmation email still sends too.
- Either value empty (or the libs missing) → calendar is a **no-op**; bookings still
  succeed. Events are back-filled later by `manage.py sync_calendar` (§3) once
  configured.
- **Attendee invites & Domain-Wide Delegation:** a plain service account may be
  refused when *inviting attendees* ("Service accounts cannot invite attendees
  without Domain-Wide Delegation"). If parents don't receive Google invites, either
  (a) enable Domain-Wide Delegation for the service account in Google Workspace
  Admin (scope `https://www.googleapis.com/auth/calendar`), or (b) rely on our
  branded confirmation email — the code already retries event creation *without* the
  attendee so the event itself always lands on the school calendar.

---

## 9. Cafeteria top-ups: payment gateways (Global Payments / Banorte) — Prompt 10

Parents add money to a child's cafeteria wallet via a **hosted payment page** (HPP).
Card data never touches our servers (PCI scope minimisation): we redirect the parent
to the gateway, and the gateway confirms the charge **server-to-server** via a signed
webhook. Only that verified webhook credits the balance — the credit is applied to the
**local ledger** (`CafeteriaBalance`), never written back to Loyverse (per
`CAFETERIA_WALLET_SPEC.md` §7 **R1**: Loyverse `total_points` is read-only).

**Flow:** `POST /api/v1/cafeteria/topup/ {student, amount, method:"online", gateway}`
→ creates a pending `TopUpRequest` + linked `Payment(type=cafeteria)` → returns the
gateway **redirect URL** → parent pays on the HPP → gateway webhook → verify signature
→ credit local ledger + `CafeteriaTransaction(topup)` → mark `TopUpRequest` completed →
notify parent (in-app + email). Declines mark both **failed** and credit nothing. The
whole path is **idempotent** — a replayed webhook is a no-op.

**URLs to register in each gateway's merchant dashboard** (prod domain
`https://interlaken.edu.mx`):

| Purpose | URL |
|---|---|
| Return URL (browser redirect back) | `https://interlaken.edu.mx/portal/cafeteria/recarga/retorno?payment_id=<id>` |
| Global Payments webhook (server→server) | `https://interlaken.edu.mx/api/v1/payments/webhook/global-payments/` |
| Banorte webhook (server→server) | `https://interlaken.edu.mx/api/v1/payments/webhook/banorte/` |
| Generic webhook (either gateway) | `https://interlaken.edu.mx/api/v1/payments/webhook/` |

The return URL is a **redirect only** — it never credits the balance (the frontend page
just polls the payment status). The **webhook** is the source of truth and MUST be the
signed, server-to-server URL.

**Webhook signature:** each webhook is authenticated with
`HMAC-SHA256(secret, raw_request_body)` (hex) sent in the `X-Webhook-Signature` header;
the endpoint **fails closed** (401) if no secret is configured or the signature doesn't
match. Configure the gateway to sign with the matching secret below. (These are plain
HTTPS endpoints under Passenger — no cron/worker needed; see §3.)

**Production `.env` (server only — never commit):**
```
DEFAULT_PAYMENT_GATEWAY=global_payments
PAYMENT_RETURN_URL=https://interlaken.edu.mx/portal/cafeteria/recarga/retorno

# Global Payments
GLOBAL_PAYMENTS_APP_ID=<merchant app id>
GLOBAL_PAYMENTS_APP_KEY=<merchant app key>
GLOBAL_PAYMENTS_ENV=live            # sandbox until credentials are verified
GLOBAL_PAYMENTS_HPP_URL=<live HPP url from provider>
GLOBAL_PAYMENTS_WEBHOOK_SECRET=<shared HMAC secret>

# Banorte "Pago en Línea"
BANORTE_MERCHANT_ID=<merchant id>
BANORTE_ENV=live                    # sandbox until credentials are verified
BANORTE_CHECKOUT_URL=<live checkout url from Banorte>
BANORTE_WEBHOOK_SECRET=<shared HMAC secret>
```

**Sandbox vs live:** with `*_ENV=sandbox` (default) and no `*_HPP_URL`/`*_CHECKOUT_URL`
set, the app builds a deterministic **sandbox** redirect URL carrying the order
reference — enough to exercise the initiate → webhook flow end-to-end without live keys.
Switch each gateway to `live` and set the provider's real hosted-page URL once merchant
credentials are provisioned. The webhook verification is **always real** — set the
`*_WEBHOOK_SECRET`s in every environment or the endpoint rejects everything (401).

> **Never** credit a balance from the browser return URL or an unsigned webhook. Do
> **not** store card/PAN data — the hosted page keeps it off our servers.

---

## 10. WhatsApp booking — Tier 1 (deep link) & Tier 2 (Cloud API bot) — Prompt 14

Parents can start a visit booking from WhatsApp. Two tiers, independent of each other:

**Tier 1 — deep link (live now, zero setup).** The "Reservar por WhatsApp" buttons
(agendar-visita, puertas-abiertas) open `wa.me/<WHATSAPP_NUMBER>?text=…` with a
prefilled Spanish message. Staff reply and create the `Booking` in Django admin
(`source=whatsapp`). Only `WHATSAPP_NUMBER` (backend) / `VITE_WHATSAPP_NUMBER`
(frontend, digits only, country code first) are needed.

**Tier 2 — conversational bot (Meta WhatsApp Business Cloud API).** Endpoint
`GET|POST /api/v1/whatsapp/webhook/`. A parent messages the number → the bot replies
with an interactive **list of the next open slots** → tapping one creates a
`Booking(source=whatsapp)` (capacity-safe, + Google Calendar §8, fail-soft) and
confirms in-channel.

> ⚠️ **Requires valid HTTPS** (§1 — the SSL fix). Meta will not register a webhook on
> an expired/invalid certificate. Works fine under Passenger — it's just an HTTPS
> endpoint, no persistent worker/Celery needed.

**One-time Meta setup:**
1. **Meta for Developers → Create app → Business → add the "WhatsApp" product.**
2. **WhatsApp → API Setup:** note the **Phone number ID** (`WHATSAPP_PHONE_ID`) and
   generate a **permanent** access token via a **System User** (Business Settings →
   Users → System Users → generate token with `whatsapp_business_messaging`) →
   `WHATSAPP_TOKEN`. (The temporary 24-h token in API Setup is only for sandbox tests.)
3. **App Settings → Basic → App Secret** → `WHATSAPP_APP_SECRET` (verifies
   `X-Hub-Signature-256` on every inbound call).
4. **WhatsApp → Configuration → Webhook:**
   - Callback URL: `https://interlaken.edu.mx/api/v1/whatsapp/webhook/`
   - Verify token: any string you invent — set the **same** value as
     `WHATSAPP_VERIFY_TOKEN`. Meta's `GET` handshake must echo the challenge (it does).
   - Subscribe to the **`messages`** field.

**Env (production `.env`):**
```
WHATSAPP_NUMBER=52155…            # Tier 1 deep link + display
WHATSAPP_TOKEN=<system-user token>
WHATSAPP_PHONE_ID=<phone number id>
WHATSAPP_VERIFY_TOKEN=<invent a string; matches Meta's webhook field>
WHATSAPP_APP_SECRET=<Meta app secret>
WHATSAPP_API_VERSION=v19.0        # optional
```

**Behaviour / guarantees:**
- **Signature is always enforced.** With no `WHATSAPP_APP_SECRET` (or a bad/missing
  `X-Hub-Signature-256`), `POST` fails closed with **403**. Never trust an unsigned call.
- Cloud API creds unset (`WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` blank) → the webhook still
  verifies signatures and answers the handshake, but outbound sends are **no-ops** (no
  crash). Set them to enable self-service replies.
- A verified `POST` always returns **200** (even if handling fails) so Meta doesn't
  retry-storm; message handling is fail-soft.

**Sandbox testing (before the WABA number is approved):**
- Use the **temporary token** + a test recipient added under WhatsApp → API Setup.
- Local: expose `http://localhost:8000` over HTTPS with a tunnel (e.g. `ngrok http 8000`)
  and register that URL + `WHATSAPP_VERIFY_TOKEN` as the webhook.
- Verify handshake:
  `curl "https://<tunnel>/api/v1/whatsapp/webhook/?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=1234"`
  → echoes `1234`.
- Simulate an inbound message: sign the JSON body with the app secret and POST it:
  ```bash
  BODY='{"entry":[{"changes":[{"value":{"contacts":[{"profile":{"name":"Ana"}}],"messages":[{"from":"5215500000000","type":"text","text":{"body":"hola"}}]}}]}]}'
  SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" | awk '{print $2}')"
  curl -X POST https://<tunnel>/api/v1/whatsapp/webhook/ \
       -H "Content-Type: application/json" -H "X-Hub-Signature-256: $SIG" -d "$BODY"
  ```
  An **unsigned** POST returns 403; a **signed** one is processed (200).

---

## 11. Backups & restore runbook

**What runs:** `python manage.py backup_database` (cron §3, daily 02:30) writes a
timestamped backup into `/home/rene82/backups/` and keeps the most recent **14**
(`--keep N` to change). MySQL → gzipped `mysqldump --single-transaction` (password
via `MYSQL_PWD` env, never argv); local SQLite dev → consistent copy via the
sqlite3 online-backup API. The repo-level `backups/` dir is gitignored.

**Off-site copy (strongly recommended):** the cPanel disk is a single point of
failure. Periodically download `/home/rene82/backups/` via cPanel → File Manager
or SFTP, or add a weekly cron that pushes the newest dump to external storage.

**Restore — MySQL (production):**
1. Put the site in maintenance (cPanel → disable the Python app or serve a static page).
2. `gunzip -k /home/rene82/backups/db-<STAMP>.sql.gz`
3. `mysql --user=rene82_interla -p rene82_interla < db-<STAMP>.sql`
4. Re-enable the app; verify: log in, open `/admin/`, run one read (alumnos list)
   and one write (test announcement), then delete the test row.

**Restore — SQLite (dev):** stop `runserver`, replace `db_local.sqlite3` with the
snapshot file, restart.

**Rules:** rehearse a restore once per school term — a backup that has never been
restored is not a backup. Always take a fresh manual backup **before** running
migrations in production (`manage.py backup_database` then `migrate`).
