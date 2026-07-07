# Prompt 15 — Tests, CI/CD & Error Monitoring

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 02 (ideally after 03–04). **Reference:** `ROADMAP.md` §A. **Size:** M–L.

## Context
See `prompts/README.md`. `pytest-django` + `factory-boy` are in requirements but there are **zero tests**; no CI; no error monitoring.

## Goal
Establish an automated safety net (backend + frontend tests), CI, and production error visibility.

## Tasks
1. **Backend tests (pytest-django):** add `backend/pytest.ini`/config + `conftest.py`. Cover the critical paths:
   - auth: email/password `token/`, Google callback happy/edge, logout blacklist;
   - permissions: admissions token gate (IDOR fixed), admin-only cafeteria endpoints;
   - webhooks: signature accept/reject + idempotency (payments; WhatsApp if present);
   - cafeteria: idempotent purchase sync, atomic top-up, low-balance alert;
   - bookings: capacity/no double-booking.
   Use `factory-boy` factories for `User`/`StudentProfile`/etc. Target meaningful coverage on `apps/`, not 100%.
2. **Frontend tests (Vitest + React Testing Library):** add config + a few high-value tests — `ProtectedRoute` role gating, `api.ts` 401→refresh interceptor, LoginPage submit paths.
3. **CI (GitHub Actions)** `.github/workflows/ci.yml`: on push/PR — backend (`ruff`/`black --check`, `pytest` on SQLite) and frontend (`npm ci`, `eslint`, `tsc --noEmit`, `vitest`, `vite build`). Cache deps.
4. **Error monitoring (Sentry):** add `sentry-sdk` (Django integration) guarded by `SENTRY_DSN` env (no-op if unset); add `@sentry/react` on the frontend similarly. Scrub PII/secrets. Add DSN keys to `.env.example`.
5. **(Optional) CD:** a manual `deploy.yml` that SSHes to cPanel and `git pull` + migrate + collectstatic (documented, not auto-triggered).

## Constraints
- Tests run on SQLite with `DJANGO_SETTINGS_MODULE=config.settings.development`, no network (mock Loyverse/gateways/Google/WhatsApp).
- Sentry/CD must be no-ops without env config.

## Acceptance / verify
- `cd backend && pytest` green locally; `cd frontend && npx vitest run` green.
- CI workflow passes on a test branch.
- With `SENTRY_DSN` set, a forced error appears in Sentry; unset → no crash.

## Do NOT
- Hit real external APIs in tests. Commit a real Sentry DSN.
