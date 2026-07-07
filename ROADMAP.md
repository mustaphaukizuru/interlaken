# Colegio Interlaken — Product & Engineering Roadmap

**Generated:** 2026-07-07 · Master index + professional recommendations
This ties together all planning docs and adds everything else worth doing, prioritized.

## Document index (already written)
| Doc | Covers |
|---|---|
| [STATUS_REPORT.md](STATUS_REPORT.md) | Current state, confirmed bugs (login broken), security holes, hygiene |
| [DEPLOYMENT.md](DEPLOYMENT.md) | GoDaddy cPanel/Passenger, MySQL, cron, SSL, Google OAuth prod, go-live checklist |
| [UI_UX_ENHANCEMENT_PLAN.md](UI_UX_ENHANCEMENT_PLAN.md) | Modern layout patterns, component system, motion, a11y |
| [BRAND_LOGO_GUIDE.md](BRAND_LOGO_GUIDE.md) | Official logo usage, favicon/PWA, palette reconciliation |
| [CAFETERIA_WALLET_SPEC.md](CAFETERIA_WALLET_SPEC.md) | Loyverse wallet: purchase alerts, balance/history, top-ups |
| [BOOKING_CALENDAR_SPEC.md](BOOKING_CALENDAR_SPEC.md) | Visit booking, Google Calendar, WhatsApp |

Everything **below is new** — professional additions not yet captured, grouped by domain and tiered by priority.

---

## Priority tiers
- **P0 — before any public launch** (correctness, security, legal, basic ops)
- **P1 — first ~90 days** (core school value + engineering maturity)
- **P2 — 3–6 months** (depth & engagement)
- **Later** — nice-to-have / scale

---

## A. Engineering & production-readiness

| # | Recommendation | Why / current state | Tier |
|---|---|---|---|
| A1 | **Automated tests** — pytest-django (API, auth, payments, Loyverse) + Vitest/RTL (frontend) | `pytest-django`/`factory-boy` are in requirements but **0 test files exist**. Payments/auth must not regress. | P0 |
| A2 | **CI/CD pipeline** (GitHub Actions: lint → test → build → deploy to cPanel via SSH/git) | No `.github/workflows`. Manual deploys are error-prone. | P1 |
| A3 | **Error monitoring** (Sentry, backend + frontend) | No visibility into production errors today. | P0 |
| A4 | **Structured logging + rotation** | Ad-hoc `logging` only; need request/audit logs on cPanel. | P1 |
| A5 | **`.env.example` + secrets discipline** | No template; onboarding/deploy relies on tribal knowledge. | P0 |
| A6 | **API documentation** (drf-spectacular → Swagger/OpenAPI) | No API docs; helps frontend + future integrations. | P1 |
| A7 | **Wire rate limiting** on login, OAuth, webhooks, top-ups | `django-ratelimit` installed but **never used** → brute-force/abuse exposure. | P0 |
| A8 | **Fix ESLint + pre-commit hooks** (ruff/black + eslint/prettier) | `npm run lint` is broken (no config); no formatting gate. | P1 |
| A9 | **DB backups + restore runbook** (cPanel backups + offsite copy) | Student/financial data — must be recoverable. | P0 |
| A10 | **Staging environment** (`staging.interlaken.edu.mx`) | Test releases before prod. | P1 |
| A11 | **Health check endpoint + uptime monitoring** (UptimeRobot/BetterStack) | Know when the site/API is down. | P1 |
| A12 | **README + developer + ops docs** | `README.md` is empty. | P1 |
| A13 | **Dependency scanning / updates** (Dependabot) | Django/React security patches over time. | P1 |

## B. Legal & compliance (Mexico-specific — often the biggest miss)

| # | Recommendation | Why | Tier |
|---|---|---|---|
| B1 | **Aviso de Privacidad** (LFPDPPP) | **Legally required** in Mexico; a school handling **minors' data** especially. Missing entirely. | P0 |
| B2 | **ARCO rights mechanism** (Acceso, Rectificación, Cancelación, Oposición) | Legal obligation tied to B1. | P1 |
| B3 | **Términos y Condiciones / Terms of Use** | Governs portal/payment usage. | P0 |
| B4 | **Cookie consent banner** | Required if analytics/tracking used. | P1 |
| B5 | **Parental-consent flow for minors' data** | Ethics + compliance for student accounts. | P1 |
| B6 | **CFDI 4.0 tax invoicing** (facturación) for tuition + cafeteria top-ups | Mexican parents expect/require tax invoices. | P1 |
| B7 | **Accessibility WCAG 2.1 AA** | Public/education obligation; also SEO. (a11y fixes already in UI plan.) | P1 |
| B8 | **Payment security posture** (keep gateways hosted/HPP → minimize PCI scope) | Already the right direction; document it. | P0 |

## C. Security hardening (beyond STATUS_REPORT §5)

| # | Recommendation | Tier |
|---|---|---|
| C1 | **2FA/MFA for admin & staff** accounts | P1 |
| C2 | **Brute-force protection** on login (ties to A7) | P0 |
| C3 | **Refresh token in HttpOnly cookie** (stop URL-query + localStorage tokens — STATUS_REPORT §5.4) | P1 |
| C4 | **Content-Security-Policy + full security headers** | P1 |
| C5 | **Audit log** for sensitive actions (grades, payments, balance adjustments, role changes) | P1 |
| C6 | **Password policy + breach check**, account lockout | P1 |
| C7 | **Signed webhooks everywhere** (payments, Loyverse, WhatsApp) | P0 |

## D. Core academic features (the real "school product" — currently absent)

| # | Recommendation | Why | Tier |
|---|---|---|---|
| D1 | **Grades / Boletas de calificaciones** | Report cards are the #1 parent expectation of a school portal. | P1 |
| D2 | **Attendance (Asistencia)** + **auto absence alert to parents** | Daily attendance; instant WhatsApp/email if a child is absent — high perceived value. | P1 |
| D3 | **Teacher portal + gradebook** | The `staff` role exists but has **no features**; teachers need to enter grades/attendance. | P1 |
| D4 | **Class schedules / Horarios** | Per-student timetable. | P2 |
| D5 | **Homework / Tareas** | Assignments + due dates + submission. | P2 |
| D6 | **Academic calendar** (holidays, exams, events) | Shared school-year calendar (reuses Google Calendar work). | P1 |
| D7 | **Parent ↔ teacher messaging** | Direct, logged communication channel. | P2 |
| D8 | **Documents / Circulares repository** | Reglamento, formatos, circulares — downloadable. | P2 |

## E. Finance beyond cafeteria

| # | Recommendation | Why / current state | Tier |
|---|---|---|---|
| E1 | **Recurring tuition (colegiatura) billing** | Today only a one-off `Payment(type=tuition)` exists — **no monthly invoices, due dates, late fees, or payment plans**. | P1 |
| E2 | **Statements & receipts** (PDF) + CFDI (B6) | Parents need records. | P1 |
| E3 | **Admin finance dashboard** (revenue, outstanding, collection rate) | Operational visibility. | P1 |
| E4 | **Scholarships / Becas** tracking & discounts | Common in MX schools. | P2 |
| E5 | **Auto payment reminders** (before due / overdue) | Reduces late payments (cron + email/WhatsApp). | P1 |

## F. Admissions completion & CRM

| # | Recommendation | Why / current state | Tier |
|---|---|---|---|
| F1 | **Finish the enrollment workflow** | `RegisterPage` is a **placeholder**; the backend registration + document surface is unused (STATUS_REPORT §6). | P1 |
| F2 | **Application status tracking** for parents | Let families see where their application stands. | P1 |
| F3 | **Document verification + e-signature** | Digital paperwork for enrollment. | P2 |
| F4 | **Lead/CRM pipeline** for prospective families | Track inquiries → visit → application → enrollment. | P2 |
| F5 | **Waitlist management** | For full grades. | P2 |

## G. Communications & engagement

| # | Recommendation | Tier |
|---|---|---|
| G1 | **Web push / PWA notifications** (installable app) | P1 |
| G2 | **Segmented email newsletters** (by grade/level/audience — fixes the announcement-audience bug too) | P1 |
| G3 | **Emergency broadcast** (WhatsApp/SMS blast) | P1 |
| G4 | **Event photo galleries** (privacy-aware, per class/event) | P2 |
| G5 | **Surveys / feedback** (satisfaction, re-enrollment intent) | P2 |

## H. Growth, SEO & analytics

| # | Recommendation | Why | Tier |
|---|---|---|---|
| H1 | **SEO** — meta tags, `sitemap.xml`, `robots.txt`, structured data (`School`/`LocalBusiness`) | Discoverability for admissions. | P1 |
| H2 | **Web analytics** (GA4 or privacy-first Plausible) + funnel tracking | cPanel already shows analytics enabled; measure the admissions funnel. | P1 |
| H3 | **Performance / Core Web Vitals** (route code-splitting, lazy images, CDN) | Partly in UI plan; ranks + converts better. | P1 |
| H4 | **Blog / Noticias** | Fresh content, SEO, community. | P2 |
| H5 | **Bilingual i18n (ES/EN)** | It's a **bilingual** school — English site strengthens positioning. | P2 |

## I. Data & operations

| # | Recommendation | Tier |
|---|---|---|
| I1 | **Bulk import** (students/parents via CSV/Excel) | P1 |
| I2 | **Reporting & exports** (enrollment, finance, attendance) | P1 |
| I3 | **Granular roles/permissions** (director, coordinator, teacher, cashier) | P2 |
| I4 | **Data retention & archival policy** (per year cohort) | P2 |

---

## Suggested sequencing (pragmatic)

1. **Stabilize & launch (P0):** STATUS_REPORT P0/P1 fixes + SSL (DEPLOYMENT) + Aviso de Privacidad/Terms (B1/B3) + rate limiting (A7) + Sentry (A3) + backups (A9) + smoke tests on auth/payments (A1) + `.env.example`/README (A5/A12).
2. **Core value + maturity (P1):** recurring tuition (E1) · attendance+alerts (D2) · grades (D1) · teacher portal (D3) · CI/CD (A2) · API docs (A6) · 2FA (C1) · CFDI (B6) · SEO+analytics (H1/H2) · PWA (G1) — alongside the cafeteria & booking specs.
3. **Depth & engagement (P2):** messaging (D7) · homework/schedules (D4/D5) · CRM (F4) · newsletters (G2) · galleries (G4) · i18n (H5).
4. **Later:** advanced analytics, native app, LMS/SIS integrations, granular roles.

> **North star:** items that are (a) legally required (B1), (b) trust/safety (security, backups), and (c) daily-value for parents (attendance alerts, grades, tuition, cafeteria) deliver the most return. The marketing site and portal are solid foundations; the gap to a *complete* school platform is the **academic + finance + compliance** layers above.
