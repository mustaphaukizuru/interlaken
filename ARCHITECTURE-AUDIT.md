# Architecture Audit — Colegio Interlaken (IK0)

> **Phase IK0** of the separate architecture plan (phases IK0–IK8, renamed to avoid
> collision with the repo's own `prompts/01–20` numbering). **Read-only audit** — no
> source was modified. Evidence cited as `path:line`. Regenerated 2026-07-08 (fresh
> independent five-domain pass) against branch `admin-refinement`.
>
> "Target" throughout means the architect's intended data model / feature set, **not**
> what the repo's own prompts aimed at.

---

## 1. STACK REALITY

| Aspect | Reality | Evidence |
|---|---|---|
| **Backend** | Django **4.2** + DRF + SimpleJWT (8h access / 7d refresh, rotation + blacklist) | `requirements.txt`, `config/settings/base.py:148-154` |
| **Frontend** | React **18.3.1** + TypeScript **5.4** + Vite **5.3**, Tailwind **3.4**, `@tanstack/react-query` 5, `zustand` 4, `react-router-dom` 6, react-hook-form + zod, axios, Sentry, vite-plugin-pwa | `frontend/package.json` |
| **Hosting target** | GoDaddy **cPanel shared hosting**, **Passenger** → `config.settings.production` | `backend/passenger_wsgi.py:12`, `DEPLOYMENT.md` |
| **DB (prod)** | **MySQL** (`utf8mb4`); driver is **PyMySQL** shimmed as MySQLdb, not the pinned `mysqlclient` | `config/__init__.py:1-3`, `base.py:87-97` |
| **DB (dev/CI/tests)** | **SQLite** (`db_local.sqlite3`) when `SQLITE_LOCAL=1` **or** a pytest/test run is detected | `development.py:13-20` |
| **Env / secrets** | `django-environ` reading repo-root `.env` (gitignored). Only `*.example` tracked (placeholders). `CLAUDE.md` (real secrets) gitignored | `base.py:9-10`; `git check-ignore` ✓ |
| **Background jobs** | **No Celery/Redis** (host can't run them) → **cron + Django management commands** | `requirements.txt:41-43` |
| **Deploys today** | Manual `workflow_dispatch` SSH deploy (`git pull`→pip→migrate→collectstatic→`touch tmp/restart.txt`); a **documented no-op until `CPANEL_*` secrets set**. Frontend built locally via `scripts/build_frontend.py` and uploaded (cPanel has no Node), served by WhiteNoise | `.github/workflows/deploy.yml`, `scripts/build_frontend.py` |

**Cron management commands:** `cafeteria/{sync_balances, sync_purchases, low_balance_alerts}`,
`finance/{generate_invoices, apply_late_fees, send_payment_reminders}`, `bookings/sync_calendar`.

---

## 2. FUNCTIONAL INVENTORY

### Django apps (9; `whatsapp` has no models)
| App | Purpose |
|---|---|
| `accounts` | Custom `User` (email login, role enum) + `StudentProfile`/`ParentProfile` 1:1 extensions; JWT + Google OAuth |
| `admissions` | Public pre-registration, full enrollment applications + document uploads, open-house sign-ups |
| `bookings` | Admin availability slots + family visit reservations (open-class / individual), capacity-enforced |
| `cafeteria` | Loyverse-backed prepaid wallet: balance, ledger, top-up requests, manual adjustments |
| `core` | Public contact form + SPA catch-all + `wa.me` redirect |
| `finance` | Recurring tuition billing: fee schedules, discounts, invoices, line items, payments, adjustments |
| `payments` | Gateway transactions (Global Payments / Banorte) + HMAC webhooks |
| `portal` | Audience-targeted announcements + per-user notifications + dashboard |
| `whatsapp` | Meta Graph API messaging + signed inbound webhook (conversational booking). No models |

### API endpoints (grouped; `/api/v1/*` unless noted)
- **Auth/accounts** — `GET /auth/google/`, `/auth/google/callback/`, `POST /auth/logout/`; `POST accounts/token/` (+`refresh/`), `accounts/google/token/`; `GET/PATCH accounts/me/`; `accounts/students/[<pk>/]`.
- **Admissions** (all public) — `pre-register/`, `register/`, `register/<pk>/[submit/|documents/]`, `open-school/[signup/]`.
- **Cafeteria** — `balance/`, `transactions/`, `topup/`; admin: `balances/`, `topup/<pk>/apply/`, `sync/<pk>/`, `sync-all/`, `topups/`, `student/<pk>/`, `adjust/<pk>/`, `refund/<pk>/`, `reconcile/`, `low-balance/`, `export/{student,school}/`.
- **Payments** — `initiate/`, `history/`, `<pk>/`; webhooks `webhook/`, `webhook/global-payments/`, `webhook/banorte/` (HMAC, csrf-exempt).
- **Finance** — `invoices/[<pk>/[pay/|receipt/]]`; admin: `dashboard/`, `invoices/`, `mark-paid/`, `adjust/`, `cancel/`, `student/<pk>/`, `generate/`, `bulk/`.
- **Bookings** — `availability/` (GET public / POST admin), create/detail/cancel (public); admin bookings + action.
- **Portal** — `dashboard/`, `announcements/`, `notifications/[<pk>/read/]`.
- **WhatsApp** — `webhook/` (GET Meta handshake / POST HMAC). **Core** — `contact/` (public, 5/m).

### Frontend routes
- **Public** (`PublicLayout`): `/`, `/nosotros`, `/admisiones`, `/pre-registro`, `/inscripcion`, `/puertas-abiertas`, `/agendar-visita`, `/contacto`.
- **Auth**: `/login`, `/auth/callback`.
- **Parent** (`['parent','admin']`): `/portal`, `/portal/cafeteria[/recarga/retorno]`, `/portal/colegiaturas[/retorno]`, `/portal/pagos`.
- **Student** (`['student','admin']`): `/alumno`, `/alumno/cafeteria`.
- **Admin** (`['admin']`): `/admin`, `/admisiones`, `/visitas`, `/cafeteria[/:studentId]`, `/finanzas`, `/alumnos`.

All pages `React.lazy` code-split; guarded by `ProtectedRoute` (`App.tsx`).

### Auth flows present
1. **SimpleJWT** email/password (`RateLimitedTokenObtainView`, 10/m) + refresh (rotation + blacklist).
2. **Token blacklist logout** (`token_blacklist` installed; `LogoutView`).
3. **Google OAuth — server code flow** (`GoogleLoginView`→`GoogleCallbackView`, mints JWT, redirects to frontend, 20/m).
4. **Google OAuth — GIS ID-token exchange** (`GoogleTokenView`, verifies `aud == GOOGLE_CLIENT_ID`, 10/m).
5. **python-social-auth session pipeline** (`/auth/social/`) — parallel, session-based; SPA uses the JWT flows.
6. **Webhook HMAC** (payments + WhatsApp, constant-time, fail-closed) + **admissions capability token** (per-object `access_token`).

DRF is **secure-by-default**: `DEFAULT_AUTHENTICATION_CLASSES=[JWTAuthentication]`, `DEFAULT_PERMISSION_CLASSES=[IsAuthenticated]` (`base.py:126-144`); every `AllowAny` is an explicit opt-out.

### Third-party integrations (only 2 genuinely wired)
| Integration | Status | Evidence |
|---|---|---|
| **Loyverse** | **WIRED** (read/sync live; remote write best-effort no-op per spec R1) | `cafeteria/services.py:74-140` |
| **WhatsApp (Meta Cloud API)** | **WIRED**, fail-soft | `whatsapp/services.py:91-94` |
| **Global Payments** | **STUB** (real HMAC webhook, fake checkout; SDK never imported) | `payments/gateways/global_payments.py:26-38` |
| **Banorte** | **STUB** (same pattern) | `payments/gateways/banorte.py:26-38` |
| **CFDI / PAC / SAT / facturación / RFC** | **DOC-ONLY** | `finance/receipts.py:5-7` — "not a fiscal CFDI"; `cfdi_available` stays False |
| **SESWEB, Twilio** | **ABSENT** | zero repo hits |

---

## 3. DATA MODEL DIFF

**Models present** (22 across 8 apps): `accounts.{User, StudentProfile, ParentProfile}`; `admissions.{PreRegistration, Registration, RegistrationDocument, OpenSchoolDay}`; `bookings.{AvailabilitySlot, Booking}`; `cafeteria.{CafeteriaBalance, CafeteriaTransaction, TopUpRequest, BalanceAdjustment}`; `core.ContactMessage`; `finance.{FeeSchedule, Discount, Invoice, InvoiceLineItem, InvoicePayment, InvoiceAdjustment}`; `payments.Payment`; `portal.{Announcement, Notification}`.

| Target concept | Verdict | Notes |
|---|---|---|
| **AcademicCycle** | **ABSENT** | "Cycle" is stringly-typed: `admissions.*.cycle` CharField (default `'2025-2026'`), `finance.*.period` `"YYYY-MM"`. No entity, no FK, no uniqueness. |
| **Household** | **ABSENT** | No family-grouping entity. Family implied only by `StudentProfile.parents` M2M (`accounts/models.py:89`). |
| **Guardian** (a user; never a student) | **EXISTS-CONFLICTS** | A guardian is `User` with `role='parent'` (+ optional `ParentProfile` 1:1). Guardians share one `User` table with students/admins/staff, split only by a **mutable `role` CharField**. No distinct entity; nothing at schema level enforces the separation. |
| **Student** (entity, NOT a user; unique card_id/barcode) | **EXISTS-CONFLICTS (major)** | `StudentProfile` is `OneToOneField(User)` (`accounts/models.py:84`) → a student **IS a login account** (role='student'), the inversion of the target. `student_id` (unique) partially covers card identity, but there is **no `card_id`/`barcode` field**; `loyverse_id` (the real POS link) is **not unique** and blank-able. |
| **Wallet** (cafeteria ledger, cycle-independent) | **EXISTS-MATCHES (partial)** | `CafeteriaBalance` + `CafeteriaTransaction` (+`balance_after` snapshots) = a genuine, **cycle-independent** prepaid ledger. Named Balance/Transaction; keyed to `StudentProfile` (inherits the Student conflict). |
| **TuitionAccount** (per-cycle, 10/11-month modality) | **ABSENT** | Billing is per-month `Invoice` keyed `(student, period)` (`finance/models.py:195`). **No per-cycle container and no 10/11-month modality field anywhere**; each month is minted independently by `generate_invoices`. |
| **Enrollment** (unique per student+cycle) | **ABSENT** | `admissions.Registration` is a pre-admission form (flat parent text fields, `cycle` string, no `StudentProfile` FK, no student+cycle uniqueness). |
| **Consent records** (LFPDPPP granular) | **ABSENT** | No consent model/fields anywhere. Only hit is a comment about Google's OAuth consent screen. Yet the app stores minors' CURP, medical data, allergies (`admissions/models.py`). |
| **Append-only AuditLog** (money + minor-data) | **EXISTS-CONFLICTS** | Two domain-specific, **mutable, manual-only** trails: `cafeteria.BalanceAdjustment`, `finance.InvoiceAdjustment`. Not append-only (ordinary editable models); log only manual admin actions (not automated `Payment`/webhook/Loyverse movements); **no minor-data mutation auditing** (StudentProfile/medical/grades edits untracked). |

**Headline:** identity is inverted & collapsed (Student = User; parents/students/admins one table by mutable role), no academic-cycle backbone (no Cycle/Enrollment/TuitionAccount, no 10/11-month modality), no Household, no LFPDPPP consent, audit partial + mutable. The **cafeteria Wallet is the single best-aligned piece.**

---

## 4. FEATURE COVERAGE MAP

| Module | State | What's missing |
|---|---|---|
| **Pre-registro público** | **DONE** | Public `PreRegistration` create + Home/Admisiones links. (Endpoint unthrottled — see §6.) |
| **Inscripción digital** (ficha + doc uploads w/ statuses) | **PARTIAL** | Backend complete (`Registration`+`RegistrationDocument` + access-token-gated `DocumentUploadView`). **Frontend not built** — `RegisterPage.tsx` is a **~42-line placeholder**, no multi-step ficha, no dropzone/FormData upload UI (ROADMAP F1). |
| **Reinscripción** | **ABSENT** | No model, route, page, or prompt for re-enrolling existing students. |
| **Cafetería wallet** | **DONE** | Purchase-sync→notify, top-up→credit (local ledger per R1), admin adjust/refund/reconcile/export, tests. Gateways sandbox-only. |
| **Pagos / colegiaturas** | **DONE** (billing) | `finance` app full; crons for generate/late-fee/reminders; parent + admin surfaces. **Live charging blocked on real gateway creds.** |
| **Facturación (RFC/CFDI)** | **ABSENT** | `receipts.py` is an internal PDF explicitly *not* CFDI; no RFC/razón-social capture, no PAC. |
| **Circulares / notificaciones** | **PARTIAL** | Notificaciones DONE (`Notification`/`Announcement` + `portal.services.notify`). **Circulares** (downloadable notice repository) ABSENT. |
| **Plataformas hub** | **ABSENT** | No route/page/model; only an orphaned `nav-plataformas` Tailwind token. |
| **Public site sections** | **PARTIAL** | Home/Nosotros/Admisiones/Contacto/Puertas Abiertas/Agendar Visita DONE. **Preescolar/Primaria/Secundaria** have no dedicated pages (mega-menu → `/admisiones`). **Fotografías** = static HomePage strip. **Plataformas/Facturación** (public) ABSENT. |
| **Admin console** | **DONE** | Jazzmin admin rebranded + responsive (5 phases); cafeteria + finance domain consoles; all 9 apps registered; React admin surfaces. |

---

## 5. DESIGN INFRASTRUCTURE

| Dimension | Grade | Evidence |
|---|---|---|
| **Tokens vs hardcoded** | ⚠️ | Real token system, but **duplicated three ways** (Tailwind theme `tailwind.config.js:6-93` + CSS vars `index.css:6-51` + `@layer components`) and leaks raw values: ~**65 raw hex across 7 files** (HomePage 32; e.g. `#080516` `HomePage.tsx:181`) plus pervasive arbitrary-px brackets — often duplicating token values as literals. Even primitives leak (`border-[#ECEAF3]` `index.css:125`). |
| **Component library** | ⚠️ | `src/components/ui` primitives exist (Button, Card, Input, Modal, Badge, EmptyState, LoadingSpinner…). **But two palettes collide:** `ui/Button`/`Card`/`EmptyState` use `brand-*`(purple)/`slate-*`/`red-600` while pages render green/coral via legacy `.btn-*`/`.badge-*` CSS classes — so `ui/Button` is partly orphaned and off-brand. `tailwind.config.js:9` even maps `brand`→**purple** while documented primary is **green**. |
| **Dark/light theming** | ❌ | No `prefers-color-scheme`, no `data-theme`, zero `dark:` variants. Dark surfaces are hardcoded-dark by design, not switchable. Only env-responsive CSS is `prefers-reduced-motion`. |
| **Mobile-first** | ✅ | Hamburger + off-canvas drawers w/ scroll-lock + Escape + `env(safe-area-inset-*)`, `100dvh`, responsive card↔table swaps, `clamp()` fluid type, **44px tap targets** enforced, `text-base` inputs (no iOS zoom). |
| **A11y basics** | ✅ | Global `:focus-visible` net (`index.css:64-72`), skip links → `#contenido`, ARIA menu roles, `role="status" aria-live`, reduced-motion honored. Minor gap: `ui/Input` doesn't wire `aria-invalid`/`aria-describedby` to its error text. |
| **Loading/empty/error** | ⚠️ | Loading ✅ (`LoadingSpinner`, Suspense, `.skeleton`, `loading={isPending}`) and Empty ✅ (`EmptyState`). **Error ❌**: `useQuery` calls destructure only `{data, isLoading}` — no `isError`/retry UI anywhere, so a failed fetch is indistinguishable from empty. **No error boundary** despite Sentry initialized (no `Sentry.ErrorBoundary` wraps the app). |

---

## 6. QUALITY & RISK

- **Tests** — Backend **9 files / 103 tests** (strong on cafeteria/finance/payments money paths, admissions perms, WhatsApp; thin on portal/core). Frontend **4 files / 13 tests** (auth + services only). **CI** (`.github/workflows/ci.yml`): ruff → black (advisory) → `manage.py check` → pytest (SQLite); frontend eslint → tsc → vitest → build. Solid.
- **Migrations** — One linear leaf per app, **no conflicts/duplicate leaves** (accounts 1, admissions 2, bookings 2, cafeteria 4, core 1, finance 1, payments 2, portal 1).
- **Secrets in code** — **None in tracked source** (`git grep` for known token/password prefixes → 0 hits); all `env(...)` reads. `.env` + `CLAUDE.md` gitignored; `venv/` no longer tracked. CI uses obvious throwaway values.
- **Security exposures to flag:**
  - **Bookings detail/cancel are `AllowAny` by raw sequential PK** with no ownership/token gate → **IDOR**: read parent PII and cancel any booking by guessing an id (`bookings/views.py:130-160`). Inconsistent with admissions' access-token pattern — the clearest API gap.
  - **Admissions `pre-register/` and `register/` unthrottled** despite sending outbound email → spam/amplification; `register/<pk>/` PATCH allows anonymous mutation, and the capability `access_token` is passed in the **URL query string** (loggable) (`admissions/views.py:30-45`).
  - **Cafeteria `IsParentOrAdmin`/`IsAdmin` read `request.user.role` without an `is_authenticated` guard** (`cafeteria/views.py:30-37`) → an anonymous caller triggers `AttributeError`/500 rather than a clean 401.
  - **`create_checkout` swallows all exceptions and returns `hpp_url=None` while still creating a PENDING Payment** → orphan payment records with no checkout URL (reconciliation risk).
  - **JWT access+refresh handed to frontend via OAuth callback URL query string** + stored in `localStorage` (STATUS_REPORT §5.4) — documented-but-open; needs one-time-code + HttpOnly cookie exchange.
- **Dead/unused dependencies** — Backend: `globalpayments-api`, `python-decouple`, `httpx`, `django-anymail` (all never imported), `mysqlclient` (redundant; PyMySQL is the real driver). Frontend: `@google/generative-ai`, `react-dropzone` (both never imported). Prune.
- **Repo's own `prompts/` pipeline — what's already built:** prompts **01–15, 17, 19 DONE** (logs + commits); **20 = deploy prep only** (automation + env template shipped; live cPanel deploy is an unverifiable ops step, **SSL expired**); **16 (legal/LFPDPPP) NOT built** — confirmed by absent `apps/legal`, absent logs, absent commits; **18 (academics) is out of scope** per the client contract. Admin + frontend UI/UX refinements (5 phases each) DONE.

---

## 7. VERDICTS

| Module | Verdict | One-line rationale |
|---|---|---|
| Auth / accounts | **REPLACE (model), KEEP (flows)** | JWT+OAuth flows are solid; the User/role identity model must be re-architected (Student-as-entity, Guardian separation). |
| Cafetería wallet | **KEEP** | Best-aligned subsystem; cycle-independent ledger + admin console + tests — only re-key to the new Student entity. |
| Finance / colegiaturas | **ENHANCE** | Solid billing; add `AcademicCycle`/`TuitionAccount` + 10/11-month modality + CFDI request. |
| Payments gateways | **ENHANCE** | Webhook plumbing real; wire live Global Payments/Banorte creds + SDK; fix the `hpp_url=None` orphan-PENDING path. |
| Admissions | **ENHANCE** | Backend fine; build the inscripción ficha UI + doc-status; add rate limits; move access-token out of the URL; link to real Enrollment. |
| Bookings | **ENHANCE** | Works; fix `AllowAny`-by-PK IDOR (ownership/token gate). |
| Portal (notif/announcements) | **KEEP** | Solid; add Circulares repository on top. |
| Public site | **ENHANCE** | Modern + a11y; add Preescolar/Primaria/Secundaria/Plataformas/Facturación/Galería; kill token bypass. |
| Admin console | **KEEP** | Rebranded, responsive, registered. |
| Design system | **ENHANCE** | Unify the two button/color systems; fix `brand`→purple vs green mismatch; enforce tokens; add query-error UX + error boundary. |
| Academics (18) / Legal (16) | **BUILD (net-new)** | Never started; both ROADMAP P1; legal is legally required in MX. |

### Recommended build order (remaining gaps)
1. **Data-model refactor (foundational):** `AcademicCycle` → `Student` as non-auth entity (unique `card_id`/`barcode`) → `Guardian`/`Household` → `Enrollment` (unique student+cycle) → `TuitionAccount` (10/11-month). Migrate cafeteria/finance FKs onto the new Student. *Everything else depends on this.*
2. **Legal/LFPDPPP (Prompt 16):** consent records + Aviso de Privacidad — legally required, blocks public launch.
3. **Append-only AuditLog:** DB-enforced immutability over money + minor-data mutations (unify the two adjustment trails).
4. **Security hardening pass:** bookings ownership gate, admissions rate limits + token-out-of-URL, cafeteria perm `is_authenticated` guard, OAuth token-in-URL → one-time-code + HttpOnly cookie, `create_checkout` orphan-PENDING fix.
5. **Inscripción ficha UI completion** + **facturación (RFC/CFDI via PAC)**.
6. **Public-site + design-system cleanup:** level pages, Plataformas hub, token enforcement, query-error UX, dead-dep prune.
7. **Go-live (Prompt 20):** renew SSL, provision live gateway creds, deploy.

---

## The 5 facts your architect must know before planning the next sprint

1. **Identity is inverted and collapsed.** `StudentProfile` is a `OneToOneField(User)` — a student *is* a login account — and parents/students/admins/staff are one `User` table split only by a **mutable `role` string**. The target's Student-as-entity / Guardian-as-user separation is a **model refactor**, not an add-on, and everything (wallet, billing, enrollment) FKs into it.

2. **There is no academic-cycle backbone.** No `AcademicCycle`, `Enrollment`, or `TuitionAccount`; "cycle" is a free-text CharField and tuition is loose per-month invoices. The **10/11-month payment modality does not exist anywhere.** Close this foundational gap first.

3. **Only Loyverse and WhatsApp are really wired.** Both payment gateways (Global Payments, Banorte) are **sandbox URL-builder stubs** with real-but-unconfigured HMAC webhooks; **all Mexican fiscal (CFDI/PAC/SAT/RFC) is doc-only.** Any "payments work" claim is billing logic, not live charging.

4. **Legal/LFPDPPP (16) was never built.** No `apps/legal`, no consent model. Legal consent is **legally required in Mexico** and gates a compliant public launch. (Academics — attendance/grades/teacher portal — is **out of scope** per the client contract.) Prompt 20 "deploy" is prep only — **the production SSL cert is expired**, blocking HTTPS, OAuth, and WhatsApp.

5. **Compliance & audit are the biggest risk cluster.** Zero LFPDPPP consent despite storing minors' CURP/medical data; audit trails are **mutable, manual-only**, covering neither automated money movements nor minor-data edits. Combined with the bookings `AllowAny`-by-PK IDOR, admissions token-in-URL, and JWT-in-URL/localStorage, the security/compliance surface needs a dedicated pass before handling real families' data at scale.

---

## IK-HOTFIX — three P1 fixes applied (2026-07-08)

Surgical remediation of three §6 findings. Full backend suite green afterward
(**122 passed**, exit 0). One conventional commit per fix:

| Fix | Commit | What changed |
|---|---|---|
| **1. Bookings IDOR** | `f4268eb` | `BookingDetailView`/`BookingCancelView` were `AllowAny` by raw PK (parent PII read + cancel-by-guess). Now require authentication + object-level ownership (booking contact email matches the guardian's account, or staff/admin); non-owners get 404 (no existence oracle). Public availability listing stays open (serializes no PII); booking creation stays public. Tests: anon→401, wrong guardian→404 (booking untouched), owner/admin→200. |
| **2. Permission-class 500s** | `6d2a6ef` | Custom `BasePermission` classes read `.role` on a possibly-anonymous user. Repo-wide audit of all four: `cafeteria.IsParentOrAdmin`, `cafeteria.IsAdmin` (unguarded) **and** `finance.IsAdmin` (guarded truthiness only — ineffective because `AnonymousUser` is truthy) now check `is_authenticated` first; `bookings.IsAdmin` already did. Anonymous → clean 401, never `AttributeError`/500. Tests cover cafeteria + finance guarded endpoints. |
| **3. Orphan PENDING payments** | `d2d39ac` | `PaymentInitiateView`'s blanket `except: hpp_url=None` (and the cafeteria online-top-up path) left unreachable PENDING payments on gateway failure. Both now mark the `Payment` **FAILED** (error+stage captured via new `Payment.mark_failed()`), log the real exception with context, and return an explicit 502. Added `find_orphan_payments` management command — **report-only**, never mutates money records. Tests: gateway exception/empty-URL → 502 + FAILED + zero PENDING orphans; happy path unchanged. |

Scope note: fixes 2 and 3 each covered a *second* occurrence of the same defect
(finance `IsAdmin`; cafeteria top-up checkout) beyond the specific lines named in
§6 — the same "fix the whole class of bug" reasoning the task applied to the
permission-class audit. No unrelated code was touched.

---

## IK-SEC + LEGAL — security hardening + LFPDPPP compliance (2026-07-08)

One conventional commit per item; full suite green before and after each. Backend
tests **122 → 164 (+42)**; frontend **13** (auth suite migrated to the memory/cookie
model, no net count change). `manage.py check` clean; frontend `tsc` + build clean.

### PART A — Security (IK-SEC)
| Item | Commit | Evidence | Tests |
|---|---|---|---|
| **A1** JWT storage | `deda010` | Refresh → httpOnly+Secure+SameSite cookie; access in memory (15 min); double-submit CSRF; rotation+blacklist on refresh; OAuth callback off-URL (`?login=ok`); React auth layer migrated same commit; `AUTH.md`. | +6 (rotation, httpOnly, CSRF, silent-refresh, logout-revoke) |
| **A2** Admissions tokens | `1e9c8a7` | One-time hashed-at-rest invite exchanged via POST for a session token (header, never a URL); single-use + expiring; uniform 401 (no PK enumeration). | 8 → 11 (+3): reuse/expired/wrong→401, hash-at-rest, no-token-in-URL |
| **A3** Append-only AuditLog | `ee37bed` | Immutable `AuditLog` (instance + queryset update/delete raise); signal auto-diffs for Payment/wallet/student/role+perm; webhook money = `system:webhook`; actor via middleware. | +6 |
| **A4** Security sweep | `f5f1cb9` | Google ID token verified locally (no `tokeninfo?id_token=` URL); logging + AllowAny serialization reviewed clean; `SECURITY-DECISIONS.md`. | +2 (GoogleToken exchange) |

### PART B — LFPDPPP compliance (IK-LEGAL)
| Item | Commit | Evidence | Tests |
|---|---|---|---|
| **B1** Consent data model | `a8eefc8` | New `legal` app: `PrivacyNoticeVersion` + immutable, granular `ConsentRecord` (5 purposes); revocation = new record; consent mutations audited (A3). | +7 |
| **B2** Consent capture | `74d70aa` | Public notice endpoint; guardian consent GET/POST (own children only); `needs_acceptance` covers new account + version change; admissions Stage-B privacy + medical gating; per-student photo flag. | +10 (7 legal API + 3 admissions) |
| **B3** ARCO rights | `0e8d29f` | `ArcoRequest` (A/R/C/O) + statutory 20-business-day deadline; parent + staff-console endpoints; Acceso household data export (own data, no secrets); status changes audited + attributed. | +5 |
| **B4** Enforcement | `0015556` | Medical fields (`blood_type, allergies, medical_notes, estatura, peso`) Fernet-encrypted at rest + serializer-gated on role + MEDICAL_DATA consent; `report_retention` command (report-only, never deletes). | +5 |

**Follow-ups (out of scope here):** the consent/ARCO React *screens* have a ready
API client (`legalApi`) and follow existing component patterns + es-MX copy;
`RegisterPage` remains the pre-existing placeholder. Prod must set a dedicated
`FIELD_ENCRYPTION_KEY` and, for split-origin, `AUTH_COOKIE_SAMESITE=None`.
