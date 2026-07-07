# Colegio Interlaken — Web App

Web application for **Colegio Interlaken**, a bilingual Preescolar/Primaria/Secundaria
school in Tlalnepantla, Mexico. The site (Spanish UI) covers public pages, admissions,
a parent/student portal, cafeteria wallet integration, payments, and visit bookings.

## Stack

- **Backend:** Django 4.2 + Django REST Framework + SimpleJWT. Apps under `backend/apps/`:
  `accounts`, `admissions`, `cafeteria`, `payments`, `portal`, `core`.
  - User model: `accounts.User` (email login, `role ∈ admin|parent|student|staff`).
  - Parent ↔ student via `StudentProfile.parents` (M2M; reverse accessor `children`).
- **Frontend:** React 18 + TypeScript + Vite 5, Tailwind CSS, `@tanstack/react-query`,
  `zustand`, `react-router-dom`, `react-hook-form` + `zod`.
- **Database:** SQLite for local dev, MySQL (via PyMySQL) in production.
- **Deploy:** GoDaddy cPanel served by Passenger (`backend/passenger_wsgi.py`).
  No Celery/Redis on the host — scheduled work runs via cron + Django management commands.

## Local dev quickstart

Requires Python 3.10+ and Node 18+. Run the two servers in separate terminals.

### 1. Environment files

```bash
cp backend/.env.example .env            # repo root; fill in values (or use SQLITE_LOCAL below)
cp frontend/.env.example frontend/.env.local
```

Secrets live in the git-ignored root `.env` — never commit real secrets.

### 2. Backend (Django, SQLite)

```bash
cd backend
python -m venv venv && source venv/Scripts/activate   # Windows Git Bash; or venv\Scripts\activate in cmd
pip install -r requirements.txt

# Local dev always uses these two settings — SQLite fallback, development config:
export DJANGO_SETTINGS_MODULE=config.settings.development
export SQLITE_LOCAL=1

python manage.py migrate
python manage.py createsuperuser        # create your admin login
python manage.py runserver 0.0.0.0:8000
```

- Django admin: http://localhost:8000/admin/
- API root: http://localhost:8000/api/v1/

On Windows `cmd`, use `set VAR=value` instead of `export`. Helper scripts
`start_backend.bat` and `start_frontend.bat` at the repo root do this for you.

### 3. Frontend (Vite)

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
```

`vite.config.ts` proxies `/api` and `/auth` to the backend on port 8000.

## Quality checks

```bash
# Backend
cd backend && DJANGO_SETTINGS_MODULE=config.settings.development SQLITE_LOCAL=1 python manage.py check
# lint/format config in backend/pyproject.toml (ruff + black, line length 100)

# Frontend
cd frontend && npm run lint          # ESLint (TS + React Hooks)
cd frontend && npx tsc --noEmit && npm run build
```

## Pre-commit hooks (optional)

```bash
pip install pre-commit
pre-commit install                   # runs ruff + black + eslint on changed files at commit time
pre-commit run --all-files           # run against the whole tree once
```

## Planning docs

High-level specs and status live at the repo root:

- `STATUS_REPORT.md` — current state, known issues, remediation order
- `ROADMAP.md` — feature roadmap
- `DEPLOYMENT.md` — cPanel/Passenger go-live notes
- `UI_UX_ENHANCEMENT_PLAN.md` — design plan
- `BRAND_LOGO_GUIDE.md` — brand & logo usage
- `CAFETERIA_WALLET_SPEC.md`, `BOOKING_CALENDAR_SPEC.md` — feature specs

## Implementation prompts

Step-by-step implementation prompts (run in order, one per session) live in
[`prompts/`](prompts/) — see [`prompts/README.md`](prompts/README.md) for the ordered index.