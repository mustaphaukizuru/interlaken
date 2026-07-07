# Prompt 02 — Make Login Work & App Deployable (P0)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 01. **Reference:** `STATUS_REPORT.md` §4, `DEPLOYMENT.md` §3–4. **Size:** M.

## Context
See `prompts/README.md`. Right now **no login path works**: `GET /auth/google/` 500s because `settings.GOOGLE_CLIENT_ID` (and `_SECRET`, `_REDIRECT_URI`, `FRONTEND_URL`) are read in `apps/accounts/views.py` but never defined in `config/settings/base.py`; and the email/password form posts to `/api/v1/accounts/token/`, which doesn't exist. The frontend also reads the wrong env-var names, and Celery/Redis can't run on the shared host.

## Goal
Login works end-to-end locally (Google + email/password), and the app's config is production-deployable on cPanel — with local SQLite dev untouched.

## Tasks
1. **Define the missing settings** in `config/settings/base.py` (read from env, keep working defaults):
   ```python
   GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID', default='')
   GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET', default='')
   GOOGLE_REDIRECT_URI = env('GOOGLE_REDIRECT_URI', default='http://localhost:8000/auth/google/callback/')
   FRONTEND_URL = env('FRONTEND_URL', default='http://localhost:3000')
   ```
   Keep the existing `SOCIAL_AUTH_GOOGLE_OAUTH2_*` lines.
2. **Add an email/password JWT login route.** In `apps/accounts/api_urls.py` add `path('token/', TokenObtainPairView.as_view(), name='token-obtain')` (import from `rest_framework_simplejwt.views`). Confirm it authenticates with the email `USERNAME_FIELD` (create a quick test user and verify a token is returned).
3. **Fix frontend env-var names.** In `frontend/src/services/api.ts` use a single consistent var, e.g. `import.meta.env.VITE_API_BASE_URL` for the API base and the OAuth redirect base; update `frontend/.env.local` / `.env.example` to match. Ensure defaults still point at `http://localhost:8000` for dev. Type them in `frontend/src/vite-env.d.ts` (`interface ImportMetaEnv`).
4. **ALLOWED_HOSTS / prod values via env.** Leave dev (`development.py` = `['*']`) as-is. Update `backend/.env.example` prod notes to include `interlaken.edu.mx,www.interlaken.edu.mx` and `FRONTEND_URL=https://interlaken.edu.mx`, `GOOGLE_REDIRECT_URI=https://interlaken.edu.mx/auth/google/callback/`.
5. **Passenger/proxy TLS.** In `config/settings/production.py` add `SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')` so `SECURE_SSL_REDIRECT` doesn't loop behind Apache/Passenger.
6. **Drop Celery/Redis** from `backend/requirements.txt` (`celery`, `redis`, `django-celery-beat`) — the host can't run them (see Prompt 08 for the cron approach).
7. **Fix the SPA root 500.** Create a minimal `backend/templates/index.html` (placeholder that loads the built assets or shows "Interlaken" in dev) so the `core/urls.py` catch-all stops raising `TemplateDoesNotExist`. Document that the real file is produced by the frontend build (see `DEPLOYMENT.md` §5).
8. **Google callback trailing slash.** Ensure `GOOGLE_REDIRECT_URI` ends with `/` to match the Django route `/auth/google/callback/`; note in `DEPLOYMENT.md` that this exact URI must be added in Google Cloud Console.

## Constraints
- Local dev must keep working on SQLite; do not hardcode prod URLs in code.
- Don't refactor the auth views' logic beyond what's needed to stop the crashes.

## Acceptance / verify
- `python manage.py check` → 0 issues.
- Start the server (`SQLITE_LOCAL=1 ... runserver`) and confirm: `GET /auth/google/` → **302** to Google (not 500); `POST /api/v1/accounts/token/` with a valid user → **200** with `access`/`refresh`; `GET /` → **200** (no template error).
- `cd frontend && npx tsc --noEmit && npm run build` → clean; email/password login and the Google button both call existing routes.

## Do NOT
- Commit real Google/DB secrets. Change unrelated endpoints. Alter the SQLite dev fallback.
