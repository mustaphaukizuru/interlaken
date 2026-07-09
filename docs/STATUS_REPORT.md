# Colegio Interlaken — Status Report

**Generated:** 2026-07-07 · **Branch:** `master` (clean) · **Analyst:** Claude Code
**Stack:** Django 4.2.13 + DRF 3.15 + SimpleJWT · React 18.3 + TypeScript 5.4 + Vite 5.3

---

## 1. Executive Summary

The application is **fully scaffolded and largely written to completion** (~2,160 LOC backend, ~3,080 LOC frontend — no `TODO`/stub markers in source). It **compiles and boots cleanly**, but it is **not usable end-to-end** because of a small cluster of high-impact defects — most critically, **no working login path exists**.

| Area | Status |
|------|--------|
| Backend boots / `manage.py check` | ✅ 0 issues |
| Migrations applied | ✅ all apps migrated (SQLite local) |
| Frontend typecheck (`tsc --noEmit`) | ✅ clean |
| Frontend production build (`vite build`) | ✅ clean (2,499 modules, 82 kB gzip main) |
| Django admin (`/admin/`) | ✅ works (Jazzmin, 302→login) |
| **User login (Google OAuth)** | ❌ **500 — crashes** |
| **User login (email/password)** | ❌ **404 — route doesn't exist** |
| Online payments | ⚠️ stub — never charges |
| Cafeteria (Loyverse) sync | ⚠️ real code, several gaps |
| Data in DB | 1 superuser, all other tables empty |

**Overall verdict:** *Solid foundation, ~1–2 days of focused fixes away from a working demo.* The blockers are concentrated and cheap to fix; the security issues must be closed before any public deployment.

---

## 2. What Works (verified live)

- **Environment:** Python 3.13 active, PyMySQL shim in place (`config/__init__.py`), running on **SQLite** locally (`db_local.sqlite3`, `SQLITE_LOCAL=1`) — MySQL is configured in `.env` but not installed locally.
- `python manage.py check` → **System check identified no issues.**
- All migrations applied across `accounts, admissions, cafeteria, payments, portal` + Django/social_django.
- `/admin/` returns 302 → Jazzmin-themed admin is functional. Superuser `admin@interlaken.edu.mx` (role=admin) exists.
- Frontend **typechecks and builds cleanly**; all referenced brand assets exist in `public/assets`.
- **Portal/admin pages are real** — every dashboard and admin page uses live `react-query` calls to the API with proper mutations + cache invalidation. No mock data in the portal.
- **Public marketing pages** (Home, About, Admissions) are complete (static in-file content — legitimate, not mock).
- **Loyverse client** (`cafeteria/services.py`) is real REST integration code, not a stub.

---

## 3. Architecture Overview

### Backend apps & models
- **accounts** — custom `User` (email login, `role` ∈ admin/parent/student/staff), `StudentProfile` (loyverse_id, M2M `parents`), `ParentProfile`.
- **admissions** — `PreRegistration` (lead), `Registration` (full enrollment w/ CURP, medical), `RegistrationDocument`, `OpenSchoolDay`.
- **cafeteria** — `CafeteriaBalance`, `CafeteriaTransaction`, `TopUpRequest` (1 Loyverse point = 1 MXN).
- **payments** — `Payment` (tuition/enrollment/cafeteria, gateway fields).
- **portal** — `Announcement`, `Notification`.
- **core** — SPA catch-all + WhatsApp redirect (no models).

### API surface
Two trees: `/auth/*` (OAuth redirect/session) and `/api/v1/<app>/` (JWT, DRF, JSON-only renderer → no browsable root; `/api/v1/` itself is 404 by design). DRF default permission = `IsAuthenticated`.

### Frontend routes
Public (`/`, `/nosotros`, `/admisiones`, `/pre-registro`, `/inscripcion`, `/puertas-abiertas`, `/contacto`) · Auth (`/login`, `/auth/callback`) · Parent (`/portal*`) · Student (`/alumno*`) · Admin (`/admin*`). Client-side `ProtectedRoute` role gating; axios with JWT interceptor + 401 refresh-retry.

---

## 4. Critical Issues (P0 — blocks basic use)

### 4.1 🔴 Google OAuth login crashes with HTTP 500 — *verified live*
`apps/accounts/views.py` reads `settings.GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `FRONTEND_URL`, but `config/settings/base.py:103-104` only defines `SOCIAL_AUTH_GOOGLE_OAUTH2_KEY/_SECRET`. Those four `settings.*` names are **never assigned**, so every auth request raises `AttributeError: 'Settings' object has no attribute 'GOOGLE_CLIENT_ID'`.
> `GET /auth/google/` → **HTTP 500** (confirmed by booting the server). `GoogleLoginView`, `GoogleCallbackView`, and `GoogleTokenView` are all non-functional.
**Fix:** add the 4 names to `base.py` (read from the already-present `.env` values).

### 4.2 🔴 Email/password login hits a nonexistent route
`LoginPage.tsx:62` POSTs to `/accounts/token/`, but `apps/accounts/api_urls.py` exposes only `token/refresh/` — there is **no `TokenObtainPairView`** anywhere → 404, form always shows "Credenciales incorrectas."
**Combined with 4.1, there is zero working login path.**
**Fix:** add `path('token/', TokenObtainPairView.as_view())` to `api_urls.py` (SimpleJWT works with the email `USERNAME_FIELD`).

### 4.3 🔴 Frontend env-var name mismatch → prod build points at localhost
`.env.local` defines `VITE_API_BASE_URL` / `VITE_GOOGLE_CLIENT_ID`, but `services/api.ts:6,46` reads `VITE_API_URL` and `VITE_API_BASE`. The configured values are **never read**; the app always falls back to hardcoded `http://localhost:8000`. Works in dev by coincidence; a production build ships pointing at localhost.
**Fix:** rename the reads to `VITE_API_BASE_URL` (and add `/api/v1` suffix consistently), or rename the `.env.local` keys.

---

## 5. Security Issues (P1 — fix before production)

> **Prompt 03 (2026-07-07) closed 5.1–5.3 and added rate limiting.** 5.4 remains
> open and is documented below with the recommended fix. See `ROADMAP.md §C`.

### 5.1 ✅ Admissions IDOR — *fixed*
`Registration` now carries an unguessable `access_token` (`UUIDField`, migration
`admissions/0002`). It is returned **once** from the create response and required
(as `?access_token=` or `X-Access-Token` header) by `RegistrationDetailView`,
`RegistrationSubmitView`, and `DocumentUploadView`; a missing/wrong token returns
**404** (no PK enumeration leak). Authenticated staff/admin (JWT) bypass the token.
The token is never included in serializer output or any list endpoint.
*(was: all three views `AllowAny`, keyed only on sequential integer `pk`.)*

### 5.2 ✅ Payment webhook now authenticated — *fixed*
`PaymentWebhookView` calls `verify_webhook(request)`, which HMAC-SHA256s the raw
body against `GLOBAL_PAYMENTS_WEBHOOK_SECRET` / `BANORTE_WEBHOOK_SECRET` and
constant-time compares to `X-Webhook-Signature`. It **fails closed** (401 when no
secret is configured or the signature is absent/wrong) and is **idempotent**: a
webhook for an already-final payment returns `already_processed` without
re-applying. Success now goes through `payment.mark_success()` (sets
`completed_at`).
*(was: `AllowAny` + `csrf_exempt`, trusts `{"status":"SUCCESS"}` blindly.)*

### 5.3 ✅ Logout invalidates refresh tokens — *fixed*
`rest_framework_simplejwt.token_blacklist` is now in `INSTALLED_APPS` (blacklist
migrations applied). `LogoutView` blacklists the refresh token and **surfaces
errors** instead of the old silent `except Exception: pass` — a missing token is
`400`, an invalid/expired/already-revoked token is `400`, and a subsequently
reused refresh token is rejected at `token/refresh/` with `401`.
*(was: `token.blacklist()` silently no-op'd because the app wasn't installed.)*

### 5.3b ✅ Rate limiting wired — *new*
`django-ratelimit` (via `apps/core/ratelimit.py`, which returns **429** on
exceed) now guards abuse-prone endpoints per client IP: `POST
/api/v1/accounts/token/` and `GoogleTokenView` (`10/m`), the Google OAuth
callback (`20/m`), `POST /api/v1/cafeteria/topup/` (`20/m`), and the payment
webhook (`120/m`, higher because a busy gateway legitimately bursts).

### 5.4 🟡 Tokens exposed in URL + localStorage — *OPEN (documented risk)*
`GoogleCallbackView` still redirects to the frontend with the JWT **access +
refresh tokens in the URL query string** (`apps/accounts/views.py`, the
`/auth/callback?access=…&refresh=…` redirect), and the SPA reads them from
`window.location` and stores both in `localStorage` (`LoginPage.tsx:26-38`).

**Why it's still open (not a quick edit):** the query-string tokens leak into
browser history, server/proxy access logs, and the `Referer` header of any
resource the callback page loads. `localStorage` is readable by any XSS. The
correct fix — a short-lived **one-time code** exchanged via POST, with the
refresh token set as an `HttpOnly; Secure; SameSite` cookie — requires a
**cross-process store** for the code→token mapping. The production target is
**cPanel shared hosting under Passenger with multiple worker processes and no
Redis** (see `deployment-infra`); Django's default `LocMemCache` is per-process,
so a cache-backed one-time code would intermittently fail when the exchange
request lands on a different worker than the callback. A robust fix therefore
needs either a DB-backed one-time-code model or a shared cache, plus matching
frontend changes at `/auth/callback` — and it cannot be end-to-end verified
locally without a live Google redirect. It was deliberately deferred rather than
shipped half-working (a broken login is worse than this documented exposure).

**Recommended fix (next security pass):**
1. Add a `OneTimeAuthCode` model (`code` = random 32+ bytes, `user`, `expires_at`
   ~120s, `used` flag) or use a shared cache backend.
2. `GoogleCallbackView` stores the code and redirects to
   `/auth/callback?code=<code>` (no tokens in the URL).
3. New `POST /api/v1/accounts/oauth/exchange/` (rate-limited, `AllowAny`) trades
   a single-use, unexpired code for the JWT pair; set the **refresh** token as an
   `HttpOnly; Secure; SameSite=Lax` cookie and return only the short-lived access
   token to JS.
4. Update `LoginPage.tsx` to read `?code=` and call the exchange endpoint.
5. Once HTTPS is restored on the host (the expired SSL cert currently blocks
   OAuth anyway — see `deployment-infra`), enable `Secure` cookies + HSTS.

Until then, mitigations already in place: access-token lifetime is 8h and
`ROTATE_REFRESH_TOKENS`/`BLACKLIST_AFTER_ROTATION` are on, so a leaked refresh
token is single-use and revocable via logout (5.3).

---

## 6. Functional Bugs & Incomplete Features (P2)

| # | Issue | Location |
|---|-------|----------|
| 6.1 | **Announcement audience never matches** — `Audience` enum is plural (`parents`/`students`), `Role` is singular (`parent`/`student`); filter `['all', user.role]` never matches targeted rows → parents/students only ever see `all`. | `portal/views.py:92,110` vs `portal/models.py:11-12` |
| 6.2 | **Online payments never charge** — Global Payments SDK is a `pass  # Wire ... here` stub; `hpp_url=None` always. | `payments/views.py:35-36` |
| 6.3 | **Online cafeteria top-up not wired** — a successful payment never calls `add_points_to_customer`; only manual admin top-up applies points. | cafeteria/payments |
| 6.4 | **Transaction history never syncs** — `get_recent_transactions` is defined but never called; `CafeteriaTransaction` only fills via admin. | `cafeteria/services.py` |
| 6.5 | **"Sincronizar todos" hits wrong endpoint** — calls `syncBalance(0)` → `/cafeteria/admin/sync/0/` instead of the existing `admin/sync-all/`. | `AdminCafeteria.tsx:26` |
| 6.6 | **RegisterPage is a placeholder** — the whole formal-enrollment + document-upload backend surface is unused; `react-dropzone` imported nowhere. | `pages/public/RegisterPage.tsx` |
| 6.7 | **Contact form goes nowhere** — `onSubmit` only calls `preventDefault()`. | `pages/public/ContactPage.tsx:59` |
| 6.8 | **`ParentProfileSerializer.students` is broken** — `source='user.parents.through'`; `User` has no `parents` accessor (reverse is `children`). Harmless only because unused. | `accounts/serializers.py:24` |
| 6.9 | **Loyverse token frozen at import** — `HEADERS` built once at module load; empty default → unauthenticated calls if env absent at import. | `cafeteria/services.py:12-18` |
| 6.10 | **Non-atomic point top-up** — read-modify-write of `total_points` races under concurrency. | `cafeteria/services.py:118` |

---

## 7. Hygiene & Quality (P3)

- 🟠 **`backend/venv/` is committed to git — 1,366 of 1,519 tracked files (90% of the repo)** are a platform-specific virtualenv. `db.sqlite3-journal` is also tracked. `.gitignore` has **no `venv` entry**.
  **Fix:** `git rm -r --cached backend/venv backend/db.sqlite3-journal` and add `backend/venv/` (and `venv/`) to `.gitignore`.
- 🟡 **Dead dependencies** — `@google/generative-ai` (no AI code anywhere), `react-dropzone` (unused). `VITE_GOOGLE_CLIENT_ID` is never read.
- 🟡 **`npm run lint` is broken** — no ESLint config file and `@typescript-eslint/eslint-plugin` isn't installed (only the parser).
- 🟡 **Dead code** — `hooks/useDashboard.ts`, `hooks/useAuth.ts`, and ~7 unused `api.ts` functions. `tsconfig` has `noUnusedLocals:false`, so these don't fail the build.
- 🟡 **Duplicate Google auth** — a custom JWT flow *and* a session-based `social_django` flow both exist and diverge.
- 🟡 **Two SQLite files** — active DB is `db_local.sqlite3` (repo root); `backend/db.sqlite3` is a stray leftover.
- 🟡 **Python drift** — committed `venv` is 3.10, but the active interpreter is 3.13 (user site-packages). Pin one.
- 🟢 **Styling inconsistency** — mix of Tailwind utilities and large inline `style={{}}` objects; functional but harder to theme.
- 🟢 **No hardcoded secrets in code** — all secrets come from `env()`; `.env` and `.env.local` are correctly git-ignored and untracked. Good.

---

## 8. Recommended Remediation Order

1. **Restore login** (P0): add `GOOGLE_*`/`FRONTEND_URL` to `base.py` (4.1) + `token/` route (4.2) + fix `VITE_*` env names (4.3). → *unblocks the entire app.*
2. **Close security holes** (P1): admissions auth (5.1), webhook signature (5.2), `token_blacklist` app (5.3).
3. **Fix functional bugs** (P2): announcement audience (6.1), sync-all endpoint (6.5), then wire payments/top-up if online payments are in scope (6.2–6.4).
4. **Clean the repo** (P3): purge committed `venv/`, remove dead deps, add ESLint config.

Items 1, 2, and the quick P2/P3 fixes are all small, localized edits — realistically a day of work to reach a secure, working demo.

---

## 9. How to Run (current, verified)

```bash
# Backend (SQLite locally — MySQL not required)
cd backend
export DJANGO_SETTINGS_MODULE=config.settings.development
export SQLITE_LOCAL=1        # Windows: set SQLITE_LOCAL=1
python manage.py runserver 0.0.0.0:8000

# Frontend
cd frontend && npm run dev   # http://localhost:3000
```
- Admin: `http://localhost:8000/admin/` — `admin@interlaken.edu.mx` / `Interla2025Admin!`
- API endpoints live under `http://localhost:8000/api/v1/<app>/` (JSON only).
- ⚠️ Login will not work until fixes 4.1–4.3 are applied.
