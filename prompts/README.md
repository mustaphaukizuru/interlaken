# Interlaken — Implementation Prompts

Ready-to-run prompts. **Open a fresh Claude Code session at `D:\Github\interlaken` and paste one prompt file at a time, in numeric order.** Each is self-contained; finish and verify one before starting the next.

## Order
| # | File | Focus | Depends on |
|---|---|---|---|
| 01 | `01-foundation-hygiene.md` | Purge `venv/` from git, `.gitignore`, `.env.example`, README, ESLint | — |
| 02 | `02-p0-deployable-login.md` | Make login work + app deployable (settings, `token/`, env vars) | 01 |
| 03 | `03-security-hardening.md` | Admissions IDOR, webhook signature, token blacklist, rate limiting | 02 |
| 04 | `04-functional-bug-fixes.md` | Announcement audience, sync-all, serializer, contact form | 02 |
| 05 | `05-brand-logos.md` | Ship official logos, rewrite `Logo.tsx`, favicon/PWA/OG | 01 |
| 06 | `06-ui-foundation-and-home.md` | Layout primitives + HomePage modernization | 05 |
| 07 | `07-ui-polish-other-pages.md` | Nav dropdown, footer, Nosotros/Admisiones/Contacto | 06 |
| 08 | `08-cafeteria-foundation.md` | Cron mgmt commands, SMTP, Loyverse client refactor, validate R1 | 02 |
| 09 | `09-cafeteria-purchases-notifications.md` | Purchase sync → balance/history/alerts | 08 |
| 10 | `10-cafeteria-payments-topup.md` | Global Payments + Banorte top-ups | 08, 03 |
| 11 | `11-cafeteria-admin-console.md` | Admin deposits/adjust/refund/reconcile | 09, 10 |
| 12 | `12-bookings-core.md` | Bookings app, availability, slot picker | 02 |
| 13 | `13-bookings-google-calendar.md` | Service-account calendar sync | 12 |
| 14 | `14-bookings-whatsapp.md` | Open-class unification + WhatsApp booking | 12, 13 |
| 15 | `15-testing-ci-monitoring.md` | pytest + Vitest + GitHub Actions + Sentry | 02 |
| 16 | `16-legal-compliance.md` | Aviso de Privacidad, Terms, cookies, ARCO | 02 |
| 17 | `17-tuition-billing.md` | Recurring colegiatura invoices | 02, 10 |
| 19 | `19-seo-analytics-pwa.md` | SEO, analytics, installable PWA | 05 |
| 20 | `20-deploy-cpanel.md` | Go-live on GoDaddy cPanel | 02–05 done |

## PROJECT CONTEXT (referenced by every prompt)
- **App:** Colegio Interlaken — bilingual Preescolar/Primaria/Secundaria school in Tlalnepantla, Mexico. **Spanish UI.**
- **Monorepo** at `D:\Github\interlaken`: `backend/` (Django 4.2 + DRF + SimpleJWT; apps in `backend/apps/`: `accounts, admissions, cafeteria, payments, portal, core`) and `frontend/` (React 18 + TS + Vite 5, Tailwind, @tanstack/react-query, zustand, react-router-dom).
- **User model:** `accounts.User` (email login, `role` ∈ `admin|parent|student|staff`). Parent↔student via `StudentProfile.parents` M2M (reverse accessor `children`).
- **Local dev:** SQLite. Always run backend with `DJANGO_SETTINGS_MODULE=config.settings.development` and env `SQLITE_LOCAL=1`. **Prod:** MySQL (PyMySQL) on GoDaddy cPanel (user `rene82`, domain `interlaken.edu.mx`), served by Passenger (`backend/passenger_wsgi.py` → production settings). **No Celery/Redis on the host — use cron + Django management commands.**
- **Dev OS:** Windows (Git Bash or PowerShell).
- **Verify after every change:**
  - Backend: `cd backend && DJANGO_SETTINGS_MODULE=config.settings.development SQLITE_LOCAL=1 python manage.py check` (expect 0 issues)
  - Frontend: `cd frontend && npx tsc --noEmit && npm run build` (expect clean)
- **Brand (keep):** official logo = multicolor clock + **green** wordmark + **coral** tagline "Tiempo de educar, tiempo de aprender". Fonts **Poppins** (display) + **Inter** (body). Accents purple `#401a8e`, pink `#ef2558`. `teal #1da2ab` is legacy/non-brand. Keep all copy **Spanish**.
- **Secrets:** in `.env` (git-ignored). Never commit secrets. Google OAuth project `interlaken-project`, prod redirect `https://interlaken.edu.mx/auth/google/callback/`.
- **Planning docs (root):** `STATUS_REPORT.md`, `DEPLOYMENT.md`, `UI_UX_ENHANCEMENT_PLAN.md`, `BRAND_LOGO_GUIDE.md`, `CAFETERIA_WALLET_SPEC.md`, `BOOKING_CALENDAR_SPEC.md`, `ROADMAP.md`.

## Global rules for every prompt
- Do **not** break local SQLite dev; do **not** hardcode production values in code — read from env with sane defaults.
- Make the smallest change that fully satisfies the task; match existing code style.
- Keep commits focused; end commit messages with the Co-Authored-By line if committing.
- Report what you changed, what you verified, and anything you deliberately skipped.
