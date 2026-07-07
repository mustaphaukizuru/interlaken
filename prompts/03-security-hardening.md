# Prompt 03 — Security Hardening (P1)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 02. **Reference:** `STATUS_REPORT.md` §5, `ROADMAP.md` §C. **Size:** M.

## Context
See `prompts/README.md`. Known holes: admissions detail/submit/document endpoints are `AllowAny` on sequential integer PKs (PII/IDOR); the payment webhook is `AllowAny` + `csrf_exempt` with no signature; logout calls `token.blacklist()` but the `token_blacklist` app isn't installed; `django-ratelimit` is installed but unused.

## Goal
Close the IDOR, authenticate webhooks, make logout actually invalidate tokens, and rate-limit abuse-prone endpoints.

## Tasks
1. **Fix admissions IDOR** (`apps/admissions/`). Pre-registration and registration creation stay public, but reads/writes must be gated. Add an unguessable `access_token = models.UUIDField(default=uuid4, editable=False, unique=True)` to `Registration`; return it from the create response; require it (query param or header) in `RegistrationDetailView`, `RegistrationSubmitView`, `DocumentUploadView`. Admin/staff (JWT) may access without the token. Make a migration.
2. **Authenticate the payment webhook** (`apps/payments/views.py`). Verify a gateway signature/HMAC before trusting `status`. For now implement a pluggable `verify_webhook(request)` that checks a shared secret/HMAC from env (`GLOBAL_PAYMENTS_WEBHOOK_SECRET`, `BANORTE_WEBHOOK_SECRET`); reject with 401 on mismatch. Make processing idempotent (ignore if `Payment.status` already final). Call `payment.mark_success()` and set `completed_at`.
3. **Enable JWT blacklist.** Add `'rest_framework_simplejwt.token_blacklist'` to `INSTALLED_APPS`, run `makemigrations`/`migrate`, and confirm `LogoutView` blacklists the refresh token (remove the silent bare-except swallow so real errors surface).
4. **Wire rate limiting** with `django-ratelimit` on: `POST /auth/...` login/OAuth exchange, `POST /api/v1/accounts/token/`, both webhooks, and `POST /api/v1/cafeteria/topup/`. Sensible limits (e.g. `10/m` per IP on login; higher on webhooks). Return 429 on exceed.
5. **(Recommended) Refresh token hardening.** Stop returning the JWT in the OAuth callback **URL query string** (`accounts/views.py`); prefer a one-time code or POST. If time-boxed, at minimum document the risk in `STATUS_REPORT.md`.

## Constraints
- Public admissions creation must still work for anonymous parents (only reads/edits get the token gate).
- Don't break existing JWT auth for the portal.

## Acceptance / verify
- `python manage.py check` and migrations apply on SQLite.
- IDOR: `GET /api/v1/admissions/register/1/` **without** the token → 403/404; **with** the correct token → 200.
- Webhook: unsigned POST → 401; correctly signed → processes once (second identical POST is a no-op).
- Logout blacklists: reusing a logged-out refresh token → 401.
- Exceeding the login limit → 429.

## Do NOT
- Weaken CORS/CSRF globally. Log secrets. Expose the `access_token` in list endpoints.
