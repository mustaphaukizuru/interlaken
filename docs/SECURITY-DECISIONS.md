# Security Decisions — IK-SEC A4 sweep

Repo-wide sweep for (a) secrets/tokens in URLs or query params, (b) sensitive
values logged in plaintext, and (c) over-serialization on `AllowAny` endpoints.
Unambiguous issues were fixed; ambiguous or accepted-risk cases are recorded below
with the recommended resolution marked **[REC]**.

## (a) Tokens / secrets in URLs — FIXED / reviewed

| Location | Finding | Resolution |
|---|---|---|
| `accounts/views.py` `GoogleTokenView` | Google ID token sent as `tokeninfo?id_token=<credential>` (credential in a URL) | **FIXED (A4)** — switched to local verification via `google.oauth2.id_token.verify_oauth2_token` (signature + audience + expiry). No token in any URL; no network round-trip. |
| `accounts/views.py` `GoogleCallbackView` | Session tokens were in the redirect URL | **FIXED (A1)** — cookies + `?login=ok`, no tokens in the URL. |
| `admissions/views.py` | `access_token` passed as a GET query param | **FIXED (A2)** — single-use hashed invite exchanged via POST; session token via `X-Session-Token` header. |
| Frontend (`api.ts`, `LoginPage`) | JWT in `localStorage` / URL | **FIXED (A1)** — access token in memory, refresh in httpOnly cookie. Grep confirms no token in `localStorage` or a URL (only tests assert absence). |
| OAuth `code` in Google→backend callback URL | Authorization `code` appears in the callback URL | **Accepted** — standard OAuth 2.0; single-use, server-side (`requests.post`), never exposed to the browser/SPA. No action. |
| `whatsapp/services.py` `hub.verify_token` (docstring) | Meta's inbound handshake carries `verify_token` in its GET | **Accepted** — Meta's protocol; verified server-side with a constant-time compare. Not our outbound URL. |

## (b) Plaintext logging of sensitive values — reviewed clean

- No `print()` in application code; no logger call emits a password, token, secret,
  credential, or full request body (grep clean).
- The `logger.exception`/`logger.error` added for checkout failures log only ids,
  gateway name, amount, and type — no card data or tokens.
- Sentry is configured with `send_default_pii=False` and a sensitive-key scrubber
  (`settings/base.py`). No change needed.

## (c) Over-serialization on `AllowAny` endpoints — reviewed clean

Every `AllowAny` endpoint returns one of: the caller's **own** just-submitted data,
**non-PII public** data, or data behind a **secondary gate** (session token / CSRF /
HMAC). Specifically:
- Admissions create/exchange/detail/submit/docs — own submission; detail/submit/docs
  additionally require the session token (A2).
- Bookings availability — `AvailabilitySlotSerializer` exposes no personal data;
  booking detail/cancel are now authenticated + owner-scoped (IK-HOTFIX).
- Payment webhooks / WhatsApp webhook — HMAC-gated; return `{detail}` only.
- Contact, open-school signup — echo the caller's own submission.
- Auth endpoints (google login/callback/token, token refresh) — return only the
  authenticated caller's own user; refresh is CSRF-gated.

## Residual / recommended (not blocking)

- **[REC]** `Payment.gateway_raw` stores the full gateway webhook payload. Card data
  never reaches us (hosted payment page), so this is low risk, but a future
  hardening could scrub the stored payload to whitelisted fields. Not done here to
  avoid altering reconciliation data mid-sweep.
- **[REC]** Split-origin deployments must set `AUTH_COOKIE_SAMESITE=None` +
  `AUTH_COOKIE_SECURE=True` (HTTPS) for the auth cookies to be sent cross-site;
  same-origin (the default) needs nothing. Documented in `AUTH.md`.
