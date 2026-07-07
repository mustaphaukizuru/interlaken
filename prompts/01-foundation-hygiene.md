# Prompt 01 — Foundation & Repo Hygiene

**Run in:** fresh Claude Code session at `D:\Github\interlaken`. **Prereqs:** none. **Reference:** `STATUS_REPORT.md` §7. **Size:** S.

## Context
See `prompts/README.md` → PROJECT CONTEXT. The repo currently commits a 1,366-file `backend/venv/`, has an empty README, a broken `npm run lint` (no ESLint config), and no `.env.example`.

## Goal
Clean the repository so it's lean, onboarding-friendly, and lint-able — without changing any app behavior.

## Tasks
1. **Stop tracking the virtualenv & stray DB journal:**
   - `git rm -r --cached backend/venv backend/db.sqlite3-journal` (keep the files on disk).
   - Add to `.gitignore`: `venv/`, `backend/venv/`, `*.sqlite3-journal`. Confirm `.env`, `.env.local`, `*.sqlite3`, `db_local.sqlite3` are already ignored.
2. **Create `backend/.env.example`** — every key from the real `.env` with **placeholder** values (no secrets): `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, all `DB_*`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `FRONTEND_URL`, `LOYVERSE_*`, `GLOBAL_PAYMENTS_*`, `EMAIL_*`, `WHATSAPP_NUMBER`, `CORS_ALLOWED_ORIGINS`. Add a `# dev: set SQLITE_LOCAL=1` comment.
3. **Create `frontend/.env.example`** mirroring `frontend/.env.local` keys with placeholders.
4. **Fix frontend linting:** add a working `.eslintrc.cjs` (TypeScript + React Hooks rules) and install the missing `@typescript-eslint/eslint-plugin` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` as devDependencies so `npm run lint` runs. Fix or `// eslint-disable` only truly noisy false-positives; do not mass-rewrite code.
5. **Add Python tooling config:** `backend/pyproject.toml` with `ruff` + `black` config (line length 100). Don't reformat the whole tree yet — just add config.
6. **Write a real `README.md`** at repo root: what the project is, stack, local dev quickstart (both servers, the SQLite env vars, superuser), where the planning docs live, and a link to `prompts/`.
7. **(Optional) pre-commit:** add `.pre-commit-config.yaml` (ruff, black, eslint) and mention how to install it in the README.

## Constraints
- No app/runtime behavior changes. Don't touch models, views, or business logic.
- Don't delete `backend/venv/` from disk (cPanel builds its own; local may use it).

## Acceptance / verify
- `git status` shows `venv/` no longer tracked; `git ls-files backend/venv | wc -l` → 0.
- `cd frontend && npm install && npm run lint` runs (warnings OK, no crash).
- `cd backend && DJANGO_SETTINGS_MODULE=config.settings.development SQLITE_LOCAL=1 python manage.py check` → 0 issues.
- `.env.example` files exist and contain **no** real secrets.

## Do NOT
- Commit any real secret. Rewrite unrelated code. Change dependencies beyond the lint plugins.
