# Authentication — Colegio Interlaken

How login, session, and logout work after the IK-SEC A1 hardening. The design
goal: **no token is ever readable by JavaScript or visible in a URL or log line.**

## Token model

| Token | Where it lives | Lifetime | Visible to JS? |
|-------|----------------|----------|----------------|
| **Access** (JWT) | Memory only — Zustand `authStore.accessToken` | 15 min | Yes (in-app only; never persisted) |
| **Refresh** (JWT) | `httpOnly` + `Secure` + `SameSite` cookie (`interlaken_refresh`) | 7 days, **rotated** on every refresh | **No** |
| **CSRF** (random) | JS-readable cookie (`interlaken_csrf`) | matches refresh | Yes (by design) |

The access token is short-lived and held in memory, so an XSS payload cannot
exfiltrate a long-lived credential from `localStorage` (there is none). The
refresh token is `httpOnly`, so JS cannot read it at all. Refresh/logout are
guarded by a **double-submit CSRF token**: the server issues a readable CSRF
cookie and requires the same value echoed in the `X-CSRF-Token` header. A
cross-site page cannot read that cookie (same-origin policy), so it cannot forge
the header.

## Flows

### Email / password login
1. `POST /api/v1/accounts/token/` `{email, password}`.
2. Server validates, sets `interlaken_refresh` (httpOnly) + `interlaken_csrf`
   cookies, returns `{access}` in the body (no refresh in the body).
3. SPA stores `access` in memory and calls `GET /api/v1/accounts/me/`.

### Google OAuth
1. Browser → `/auth/google/` → Google consent → `/auth/google/callback/`.
2. The **callback sets the session cookies and 302-redirects to
   `FRONTEND_URL/login?login=ok`** — no token in the URL. (It must land on
   `/login`, not `/auth/*`: the whole `/auth/*` prefix is reserved for the
   backend — the Vite dev proxy and Django's SPA catch-all both route it to
   Django, so an `/auth/callback` SPA route is unreachable.)
3. `LoginPage` sees `?login=ok` and calls the refresh endpoint (below) to mint an
   in-memory access token from the cookie, then `/me`.

### Silent refresh (access expiry & reload)
- On any `401`, the axios interceptor calls
  `POST /api/v1/accounts/token/refresh/` (cookie sent automatically, CSRF header
  echoed). The server **rotates** the refresh token (blacklisting the old one),
  re-sets both cookies, and returns a fresh `{access}`. The original request is
  retried once. Concurrent 401s share a single in-flight refresh.
- On reload, a persisted `isAuthenticated` user has no in-memory access token, so
  `App` calls `bootstrapSession()` once to re-mint it from the cookie.

### Logout
- `POST /auth/logout/` (auth + CSRF): **blacklists** the refresh token and clears
  both cookies. The client drops the in-memory access token and redirects home.

### Admin-managed password reset (family accounts)
`POST /api/v1/accounts/admin/users/<id>/set-password/` — admin only.

Imported families (`import_students`, `loyverse_import`) are created with
`set_unusable_password()`, and their synthetic
`<matricula>@alumnos.interlaken.edu.mx` address receives no mail, so neither
self-service reset nor Google OAuth can bootstrap them. School policy is that
**only an administrator resets a family password**; this endpoint is that path
(UI: *Alumnos → ficha del alumno → Padres y tutores → Restablecer contraseña*).

| Body | Effect |
|------|--------|
| `{}` | Server generates a 16-char password over a look-alike-free alphabet and returns it **once** as `temporary_password`. |
| `{"password": "…"}` | Uses it, after `validate_password`; **never echoed back**. 400 + messages if it fails the policy. |
| `{"reason": "…"}` | Optional; stored on the audit row. |

Rails: refuses (403) when the target is `role == 'admin'` or `is_superuser` (an
admin rewriting a peer's password would be an account-takeover primitive —
admins use the normal flow); blacklists **every outstanding refresh token** for
the target, so sessions opened with the old credential die with the reset
(`sessions_revoked` in the response); throttled at `admin-set-password`
(20/min, per user); writes one append-only `AuditLog` row
(`action=permission`, `context=accounts.set_password`) with the actor, the
target and the reason — never the password.

### Password policy
`AUTH_PASSWORD_VALIDATORS` (base settings) applies to every endpoint that
accepts a password — self-service reset/activation, authenticated
`set-password`, and the admin reset above: minimum **10** characters, not
similar to the account's own email/name, not in Django's common-password list,
not all digits.

## Configuration

Backend (`config/settings/base.py`, overridable via env — see `.env.example`):

| Setting | Default | Notes |
|---------|---------|-------|
| `ACCESS_TOKEN_LIFETIME` | 15 min | short-lived by design |
| `REFRESH_TOKEN_LIFETIME` | 7 days | rotated each refresh |
| `AUTH_COOKIE_SECURE` | `not DEBUG` | force `True` in prod (HTTPS) |
| `AUTH_COOKIE_SAMESITE` | `Lax` | `None` (+Secure) only for split-origin |
| `AUTH_COOKIE_DOMAIN` | unset | e.g. `.interlaken.edu.mx` to share subdomains |

Frontend: leave `VITE_API_BASE_URL` **blank** so the SPA is same-origin with the
API (prod: served by Django; dev: via the Vite proxy for `/api` and `/auth`).
Same-origin is required for `SameSite=Lax` cookies to accompany XHR.

## Dev caveat (cross-origin)

Because the auth cookies are same-origin, the browser must reach the backend
through the **same origin it loads the SPA from**. In dev that is the Vite proxy
(`localhost:3000` → `:8000`). For the Google flow specifically, set
`GOOGLE_REDIRECT_URI` to the **proxied frontend origin**
(`http://localhost:3000/auth/google/callback/`) and register that URI in Google
Cloud Console, so the callback's `Set-Cookie` is stored under `localhost:3000`.
In production the SPA and API share one origin, so no special handling is needed.

## Threats addressed
- **Token theft via XSS** — no long-lived token in JS-reachable storage; access
  token is memory-only and expires in 15 min; refresh token is `httpOnly`.
- **Token leakage via URL/referrer/logs** — no token is ever placed in a URL.
- **CSRF on cookie endpoints** — double-submit token on refresh/logout.
- **Refresh-token replay** — rotation + blacklist invalidates a used token.
