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
