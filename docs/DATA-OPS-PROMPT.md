# Data Operations Round: analysis and implementation prompt

Written 2026-09-24 from a full read of the codebase (frontend pages, shared table layer, every API list endpoint, every model, CI gates, deploy constraints and the backlog). Part A is the analysis. Part B is the prompt to paste into a fresh Claude Code session at the repo root. Part B is self-contained: it repeats every fact from Part A that the implementer needs. Part C (added the same day from a client report) is a production defect in the Loyverse roster sync with its own paste-ready prompt; it ships first, as Phase 0.

---

## Part A: what exists, what is missing, and where

### A1. The short version

The console already has the skeleton of a professional data layer, built in PRs #165, #169, #170, #185 and P1-A8:

| Piece | Where | State |
| --- | --- | --- |
| Shared table renderer | `frontend/src/components/ui/DataTable.tsx` (109 lines) | Server sort rendering, loading/error/empty, pagination, mobile cards via `data-label`. No selection, no column controls, no toolbar, no tests. |
| Sort helpers | `frontend/src/components/ui/SortableTh.tsx` (desc → asc → clear), duplicated with the opposite cycle in `frontend/src/lib/rosterTable.ts` | Two implementations. |
| Server sort whitelist | `backend/apps/core/ordering.py` `apply_ordering(qs, request, allowed, default)` with `-pk` tiebreak | Used by only 3 endpoints (payments, audit, cafetería transactions). Students has its own inline whitelist. |
| URL-synced filters | `frontend/src/hooks/useUrlFilters.ts` | Used by ~9 pages; the rest keep filters in `useState`. |
| Export button | `frontend/src/components/admin/ExportMenu.tsx`, `downloadBlob` in `frontend/src/services/api.ts:648`, `backend/apps/core/exports.py` | Used by 2 pages. CSV only, plus text-only PDF from `backend/apps/core/pdf.py`. Several exports ignore active filters. AdminPayments exports through the family endpoint. |
| Import | `backend/apps/accounts/import_students.py` + `frontend/src/components/admin/ImportStudentsModal.tsx` | One CSV importer (students) with server dry-run. No template, no error-report file, no XLSX, matrícula not normalised, parent email matched case-sensitively. |
| Bulk actions | `backend/apps/accounts/student_admin.py:181 AdminStudentBulkView`, `backend/apps/cafeteria/views.py:1544 AdminBulkTopUpView` | Students (status/group/grade, desktop only, no confirm) and bulk top-up by criteria. Nothing else. |
| Column controls | `frontend/src/lib/rosterTable.ts` (visibility + density, localStorage `interlaken:roster-prefs`) | Roster only, not in DataTable. |
| Audit | `backend/apps/core/audit.py record(...)` + signal tracking | Not written for booking confirm/cancel, admissions status PATCH, password-request reject, contact handled, announcement edits, CSV import, most exports. |
| Workflow guards | none | Every status endpoint accepts any target status except PasswordRequest, TopUpRequest apply and the payments webhook. |

Everything the user asked for (carga masiva, import with validation + dedupe + error file, sort on every column, multi-format export, complete search, multi-select with bulk actions, full CRUD and workflow actions, column controls, engine tightening) is therefore an **extension of existing patterns to every table**, plus a handful of new shared modules. No new frontend dependency is needed. One backend dependency is needed (`openpyxl`, pure Python).

### A2. Capability matrix today (admin console)

Y = yes, P = partial, N = no. "Sort" and "Search" mean server-side.

| Page (route) | List impl | Search | Sort | Filters in URL | Select/bulk | Export | Import | CRUD | Workflow | Column ctrls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Alumnos `/admin/alumnos` | hand-rolled + mobile list | Y | Y (own impl) | Y | Y desktop only | P (search only) | Y CSV + Loyverse | P (no delete/archive) | P | P |
| Admisiones: pre-registros | DataTable | Y (state, not URL) | N | N | N | Y CSV | N | N | Y inline status, invite | N |
| Admisiones: inscripciones | DataTable | N | N | N | N | Y CSV (no filters) | N | N | Y review modal | N |
| Pipeline | kanban | N | N | N | N | N | N | N | Y | N |
| Visitas: reservas | DataTable | N (API has `q`) | N | N (state) | N | Y CSV | N | N | P (no `no_show` in list) | N |
| Visitas: horarios | list | N | N | P | N | N | N | P | Y | N |
| Cafetería: Saldos | DataTable | P (client, one page) | N | Y | N | Y CSV/PDF (no filters) | N | N | Y sync, bulk top-up | N |
| Cafetería: Depósitos / POS | DataTable | N | N | P | N | N | N | N | Y apply, loaded, unloaded | N |
| Cafetería: Reconciliación / Saldo bajo | DataTable | N | N | P | N | N | N | N | Y fix | N |
| Cafetería: Clientes Loyverse | DataTable | Y | N | Y | N | N | N | N | N | N |
| Cafetería: alumno | DataTable ×2 | N | N | N | N | Y CSV/PDF | N | P adjust | Y refund | N |
| Comunicados | list | N | N | N | N | N | N | Y | Y activate, broadcast, resend | N |
| Auditoría | DataTable | P (actor, context) | Y 4 cols | Y | n/a | Y CSV | n/a | n/a | n/a | N |
| Pagos | DataTable | Y | Y 4 cols | Y | N | P wrong endpoint | N | n/a | n/a (webhooks) | N |
| Contraseñas | list | N | N | P | N | N | N | P | Y resolve/reject | N |
| Mensajes | list | Y | N | Y | N | N | N | N | Y handled | N |
| Usuarios | list | N | N | N | N | N | N | P (no delete, no empty state) | Y deactivate, reset | N |
| Calendario | list | N | N | N | N | N (no .ics) | N | Y | P | N |
| Testimonios | list | N | N | N | N | N | N | Y | P | N |
| Contenido (páginas) | list | N | N | N | N | N | N | Y | Y publish/review | N |
| Formularios + envíos | list + modal | N | N | P | N | Y CSV (uncapped) | N | Y | Y handled | N |
| Navegación (redirects) | list | N | N | N | N | N | N | Y | N | N |
| Medios | grid | Y | N | Y | N | N | P multi-upload, silent >10 MB drop | Y | N | N |
| ARCO | list | N | N | Y | N | N | N | P intake | Y status (no guard, no error state) | N |
| Portal familias: Pagos, Cafetería, Comunicados, Notificaciones, Inscripciones | lists | N | N | mixed | N | P (cafetería export ignores filters) | N | n/a | mark read, top-up | N |

### A3. Backend facts that shape the design

- Every API view is a plain `APIView` or `generics.*`. No ViewSets, no routers, no `@action`. URL wiring is by hand in `backend/config/urls.py`, `backend/apps/accounts/api_urls.py`, `backend/apps/core/api_urls.py` and each app's `urls.py`.
- `REST_FRAMEWORK` (`backend/config/settings/base.py:198-228`): JWT only, `IsAuthenticated` default, `DEFAULT_FILTER_BACKENDS` = DjangoFilterBackend + SearchFilter + OrderingFilter, `PageNumberPagination` with `PAGE_SIZE 20` and **no `page_size_query_param`**, JSON renderer only, no custom exception handler.
- **Ordering bug:** the implicit `OrderingFilter` runs after the hand-written `apply_ordering` on generic lists, accepts any serializer field, re-sorts and drops the `-pk` tiebreak. `?ordering=actor` on the audit log sorts by `actor_id`. No view declares `ordering_fields`. `django-filter` is installed (26.1) but no view declares a FilterSet.
- Search param names differ: `search` (students, pre-registrations), `q` (bookings, payments, contact, media, customers), `actor`/`context` (audit).
- Pagination differs: DRF page, hand `?page=` with `{count, results}`, `limit/offset` (reconcile), caps (200/500), or `pagination_class=None` (pages, forms, redirects, testimonials, calendar). `PipelineView` is unbounded. `FormSubmissionsView` caps at 500 with no pager. `AdminBalancesView` paginates an **unordered** queryset (CafeteriaBalance has no `Meta.ordering`; the warning is silenced in `pytest.ini`).
- Date range filters use `field__date__gte/lte` in: `payments/views.py:327,330,442`, `cafeteria/views.py:197,200,245,367,1067,1070,1512`, `core/views.py:136,139`, `core/dashboard.py:27`, `portal/analytics.py:84`. On Postgres this defeats b-tree indexes.
- Exports: in-memory `HttpResponse`, caps 5000 / 10000 / none, only admissions exports are audited (via a `rows[0]` hack). Streaming and background jobs do not exist.
- No Celery/Redis by design. Cron runs management commands (`deploy/crontab.example`). gunicorn is 3 sync workers with `--timeout 60` (`backend/entrypoint.sh:24-27`). **Imports and exports must finish inside one request.**
- Upload limits: `FILE_UPLOAD_MAX_MEMORY_SIZE` / `DATA_UPLOAD_MAX_MEMORY_SIZE` = 10 MB are not hard limits; views enforce size themselves. Caddy sets no body limit.
- Audit: `record(action, instance, changes=None, *, actor=None, actor_label='', context='')` in `backend/apps/core/audit.py:74`; signal tracking via `register_audit` is **bypassed by `.update()` / `bulk_update()`**. AuditLog and ConsentRecord querysets raise on `.update()` / `.delete()`.
- Permissions: `backend/apps/core/permissions.py` `IsAdmin`, `IsAdminOrStaff`. Local duplicates exist (`IsParentOrAdmin` in cafetería, `IsStaffOrAdmin` in portal analytics, `_is_staff()` in admissions).
- Throttles: only `payment-initiate` 10/min and `admin-set-password` 20/min via `apps.core.throttling.SharedScopedRateThrottle`. No import/bulk/export throttle.
- Existing patterns to copy: `import_students.py` (savepoint per row, 500 rows, `utf-8-sig`), `loyverse_import.py` + `cafeteria/services.py:2031` (commit flag, report), `AdminBulkTopUpView` (preview flag, ≤500 ids, per-row failures), `AdminStudentBulkView` (`select_for_update`, one `record()` per row), `AdminAuditExportView` (`core/views.py:254`, subclasses the list view so filters and ordering are reused).

### A4. Data-model facts (dedupe keys, indexes, hazards)

- Postgres in production, SQLite under pytest. No Postgres-only feature is used today. `select_for_update` is a no-op on SQLite; `iexact`/`icontains` are ASCII-only on SQLite.
- Dedupe keys per entity:
  - Students: `StudentProfile.student_id` (unique) normalised with `cafeteria/services.py:2008 _matricula()` (strips the `ci` prefix). The CSV importer (`import_students.py:103,128`) does **not** normalise, so `ci09938` duplicates `09938`. Secondary: `loyverse_id` (indexed, **not unique**), `LoyverseProfile.customer_code` (not indexed), `curp` (not unique, not indexed, warn only).
  - Users/guardians: `lower(email)`. `User.email` is unique **case-sensitively**; `normalize_email` lowercases only the domain. `import_students.py:131,159,178` and `cafeteria/services.py:2102` match with exact `email=`. `import_students_from_loyverse` (`services.py:2109-2111`) rewrites an existing User's role to student on email match.
  - Pre-registrations: `(lower(parent_email), lower(child_first_name), lower(child_last_name), child_dob)`, warn only (families re-apply). Retention overwrites `parent_email` with `'[eliminado por retención]'`; dedupe must ignore it.
  - Bookings: `(slot, lower(parent_email))`. Slots: `unique_together (visit_type, date, start_time, end_time)`.
  - Loyverse: `LoyverseProfile.loyverse_id`, `CafeteriaTransaction.loyverse_receipt_id`, `UnmatchedReceipt.receipt_number` (all unique).
  - Content: Page/FormDefinition `slug`, Redirect `from_path`, MediaAsset `sha256` (indexed, not unique), EnrollmentFee `(section, modality)`.
- Missing indexes (none of these tables has any): PreRegistration, Registration, ContactMessage, FormSubmission, ArcoRequest. Also missing: `TopUpRequest (status, -created_at)`, `Payment created_at`, `CafeteriaTransaction date`, `UnmatchedReceipt resolved_at`, `LoyverseProfile customer_code`, `BalanceAdjustment created_at`, `AuditLog (action, -created_at)`. AuditLog is the largest table (3 rows per POS purchase, never purged) and its `context`/`actor_label` `icontains` filters are sequential scans.
- Hazards for bulk work:
  - `CafeteriaTransaction.loyverse_receipt_id` is `unique=True, blank=True`; `adjust_balance` (`services.py:1193-1205`) inserts `''` then stamps `adjust-tx-<id>`, so two concurrent adjustments collide on Postgres.
  - `AdminBookingActionView` confirm (`bookings/views.py:292`) re-confirms cancelled/no-show bookings without a capacity check; reschedule counts rows, not `num_attendees`.
  - `apply_status` (student baja) does not surface a remaining wallet balance.
  - Side effects (emails, Google Calendar, Loyverse mirror, guardian notify) run inline per row.
  - `PreRegistration.cycle` / `Registration.cycle` default to the hard-coded `'2025-2026'`.

### A5. Frontend facts that shape the design

- Stack: React 18.3, react-router 7, TanStack Query 5, axios, zod 4 + react-hook-form (unused in admin), date-fns, react-hot-toast, lucide-react, Tailwind 3.4, Vite 8 (Rolldown, `advancedChunks`), vitest 4, Playwright. **No table lib, no CSV/XLSX lib, no dropzone, no virtualization.** Do not add any.
- No hooks layer: every page inlines `useQuery`/`useMutation` with ad-hoc keys and hand invalidation. Two DRF error mappers: `frontend/src/cms/editor/helpers.ts:49 apiErrors()` and `frontend/src/components/admin/StudentFormModal.tsx:22 fieldErrorsFrom()`.
- Shared pieces to reuse: `Modal.tsx`, `ConfirmDialog.tsx` (`requireText`), `EmptyState.tsx`, `ErrorState.tsx`, `TableSkeleton.tsx`, `Dropdown.tsx`, `Badge.tsx`, `Button.tsx` (`loading`), `PageHeader.tsx`, `ActiveFilterChips.tsx`, `DateRangeFilter.tsx` (presets hoy/7d/30d/mes/ciclo), `Pagination.tsx` (prev/next only), `lib/pagination.ts` (`ADMIN_PAGE_SIZE=20`, `toPaged`).
- CSS: `frontend/src/index.css:216-254` `.admin-table-wrap` (sticky header, 68vh), `.admin-table--dense`, stacked cards under 768px driven by `data-label`.
- Service worker (`frontend/vite.config.ts`): `navigateFallback: null` enforced by `frontend/scripts/check-sw.mjs`; generic `/api/` GETs are cached NetworkFirst for 5 min; payments and cafetería balance are NetworkOnly; `globIgnores` excludes `**/assets/Admin*.js` from precache. CSP: `worker-src 'self'`, `img-src blob:`; blob `<a download>` works.
- Budgets (`docs/PERFORMANCE.md`, `npm run check:budgets`): public routes 150 kB gz, any single chunk over 120 kB gz fails, portal-only chunks must never be imported by a public route.
- Tests: `vi.mock('@/services/api', ...)` + `frontend/src/test/renderWithProviders.tsx`. **Zero tests** for DataTable, SortableTh, Pagination, ExportMenu, useUrlFilters, ImportStudentsModal.
- UX rules (`docs/DESIGN.md`, `docs/RESPONSIVE.md`, `frontend/BRAND.md`): es-MX copy, usted, MXN, DD/MM/YYYY; tokens only, no raw hex; lucide icons only; 44 px tap targets; 16 px inputs; tables collapse to cards under 768 px; modals are bottom sheets under `sm`; `aria-sort` on sortable headers; every icon-only button has an `aria-label`.

### A6. Decisions this round makes (so the implementer does not re-litigate)

1. **XLSX export and XLSX import are in scope.** This reverses BACKLOG P1-H2 ("XLSX not needed") at the owner's request. Record it in the BACKLOG decision log.
2. **No background workers.** Bounded synchronous work with hard caps and a documented time budget. Row caps: import 2,000 rows / 5 MB; export CSV and XLSX 10,000 rows; export PDF 1,000 rows. Above cap: HTTP 413 with the es-MX message "Acote los filtros: el límite es N filas."
3. **Upgrade `DataTable` in place.** No TanStack Table. Selection, bulk bar, toolbar, column visibility, density, pinned first column and resizable widths go into the existing component.
4. **Stateless error reports.** The client re-posts the same file with `report=csv|xlsx` to receive the annotated file. No server-side job storage (LocMem cache is per-process across 3 workers).
5. **One list contract** for every admin list: `q`, `ordering` (whitelist + `-pk`), `page`, `page_size` (≤100), entity filters via django-filter FilterSets, aware-datetime date bounds. Old param names stay as aliases for one release.
6. **One bulk contract** with explicit transition tables, per-row savepoints, per-row audit, side-effect batching, hard cap 500 ids per call.
7. **Money scope is unchanged:** cafetería top-ups are the only money path; payments state is owned by webhooks; Django admin stays read-only for people and money.

---

## Part B: the prompt

Copy everything between `BEGIN PROMPT` and `END PROMPT` into a new Claude Code session opened at `D:\Github\interlaken`.

```
BEGIN PROMPT
```

# Mission

You are the lead full-stack engineer on **Interlaken**, a Django 6.1 + DRF 3.18 backend (`backend/`) with a React 18 + TypeScript + Vite 8 frontend (`frontend/`), deployed as one Docker image behind Caddy on a 2-vCPU VPS at https://interlaken.edu.mx. The app has three surfaces: the public site and family portal (`/`, `/portal/*`), the React admin console (`/admin/*`, `/staff/*`) and the Django admin (`/django-admin/`, read-only for people and money).

Your job is the **Data Operations Round**: give every table and list in the admin console (and the relevant family-portal lists) a complete, consistent, professionally wired set of data operations, then tighten the engine underneath. Concretely, on every page where it makes sense:

1. **Carga masiva / import** from CSV and XLSX with a downloadable template, server-side validation, duplicate detection (inside the file and against the database), a mandatory dry-run preview, and a **downloadable error-report file** in the same format as the upload.
2. **Sort on every column** that maps to a database field, server-side, with a stable tiebreak.
3. **Export** of the current view (filters + search + sort honoured) in **CSV, XLSX and PDF**, plus "export selected rows".
4. **Complete search**, server-side, over the fields a person would actually type (names, matrícula, emails, phones, titles, references), accent- and case-insensitive on Postgres.
5. **Multi-row selection** (page, and "select all N matching") with a **bulk action bar**, confirmations, per-row result reporting and audit.
6. **Full CRUD and workflow actions** (approve, reject, cancel, confirm, attended, no-show, resolve, publish, archive, activate, deactivate, apply, mark handled, etc.) wherever the entity has a lifecycle, with explicit transition rules, guards and audit.
7. **Large-table column controls**: column visibility, density, pinned first column, resizable widths, persisted per table.
8. **Engine tightening** at the end: indexes, query budgets, dead code, consistent contracts, docs.

Work as a senior engineer who ships in reviewable PRs, keeps CI green at every step, and never guesses when the code can be read.

# Working method (non-negotiable)

- **Read before you write.** Line numbers in this brief were accurate on 2026-09-24 and will drift. Before editing any file named here, open it and confirm the symbol. Use `rg` to find call sites.
- **One PR per phase** (defined below), branch names `feat/data-ops-<phase>`, Conventional Commits with scope (`feat(admin): …`, `feat(api): …`, `perf(api): …`, `test(...)`). Merge target is `master`. Do not squash phases together.
- **Every PR passes the real gates locally before you open it:**
  - backend: `cd backend && ruff check . && black --check . ; python manage.py check && pytest -q`
  - frontend: `cd frontend && npm run lint && npm run typecheck && npm run test && npm run build && npm run check:budgets && npm run check:sw`
  - Fix root causes. Never raise a budget number, never silence a warning, never skip a hook.
- **Tests are part of the deliverable**, not a follow-up. Backend: pytest next to the app (`apps/<app>/test_*.py`), `pytestmark = pytest.mark.django_db`, `reverse()` for URLs, fixtures from `backend/conftest.py` (`api_client`, `admin_user`, `admin_client`, `parent_user`, `auth_client`), factories in `apps/accounts/factories.py` and `apps/payments/factories.py`, uploads via `io.BytesIO(...)` with `.name` and `format='multipart'`, query budgets via `django_assert_num_queries`. Frontend: vitest with `vi.mock('@/services/api', ...)` and `src/test/renderWithProviders.tsx`; shared components get their own `*.test.tsx`.
- **Report after each phase** in this exact shape: what shipped (files), the capability matrix delta for the pages touched, test counts added, anything deferred with the reason, and the exact commands you ran with their results. Do not claim a gate passed unless you ran it.
- **Stop and ask only** if a decision would change money flows, delete data, or contradict a rule in this brief. Everything else: decide, note it in the PR description, move on.

# Hard constraints (breaking any of these fails the round)

1. **No background workers.** There is no Celery, Redis or job queue, by decision (`backend/requirements.txt` comment, `docs/GO-LIVE-AUDIT.md` #16). gunicorn runs 3 sync workers with `--timeout 60` (`backend/entrypoint.sh`). Every import, export and bulk action must complete inside one request with a hard cap and a measured time budget. Caps: import 2,000 rows or 5 MB; export CSV/XLSX 10,000 rows; export PDF 1,000 rows; bulk 500 ids per call. Over cap → HTTP 413, body `{"detail": "Acote los filtros: el límite es N filas."}`.
2. **No new C-compiled Python dependency** (the production image has no compiler). Add exactly one backend dependency: `openpyxl` (pure Python), pinned in `backend/requirements.txt`. No pandas, no reportlab, no django-import-export.
3. **No new frontend dependency.** No TanStack Table, no papaparse, no SheetJS, no react-dropzone, no virtualization library. Parse files on the server; use native HTML5 drag-and-drop; keep chunks under the budget.
4. **Bundle gates:** `npm run check:budgets` (any chunk over 120 kB gz fails; public routes 150 kB gz) and `npm run check:sw` (`navigateFallback: null`, excluded prefixes `/api|django-admin|auth|static|media`) must stay green. New shared admin modules must be reachable only from admin/staff routes and must not enter the precache (`globIgnores` `**/assets/Admin*.js` in `frontend/vite.config.ts`; if you create a shared admin chunk, name it so the ignore matches or extend the ignore).
5. **Service worker and downloads:** generic `/api/` GETs are cached NetworkFirst for 5 minutes. Add a **NetworkOnly** runtime-caching rule for `^/api/v1/.*/(export|import)/` and `^/api/v1/.*/template/` placed **above** the generic `/api/` rule. Keep payments and cafetería balance NetworkOnly.
6. **Money scope:** cafetería top-ups are the only money path; payment status is owned by the gateway webhook (`backend/apps/payments/views.py` webhook state machine); refunds go through `refund_transaction`. Never add tuition/enrollment billing (the `finance` app is retired). The Django admin stays read-only for people and money (`docs/ADMIN-VS-PORTAL.md`).
7. **Audit everything that changes state or exports personal data.** Use `apps.core.audit.record` (one entry per row for bulk actions, plus one summary entry). Signal-based auditing is bypassed by `.update()` / `bulk_update()`, so bulk paths must loop and `save()` or call `record()` explicitly. `AuditLog` and `ConsentRecord` querysets raise on `.update()` / `.delete()`. Medical fields go through `mask_medical()` in every export.
8. **Permissions:** admin endpoints use `apps.core.permissions.IsAdmin`; CMS pages/media use `IsAdminOrStaff`. Consolidate the local duplicates (`IsParentOrAdmin` in `apps/cafeteria/views.py`, `IsStaffOrAdmin` in `apps/portal/analytics.py`, `_is_staff()` in `apps/admissions/views.py`) into `apps/core/permissions.py` without changing behaviour.
9. **UX rules:** es-MX copy, register "usted", MXN, DD/MM/YYYY; Tailwind tokens only (never raw hex; `green.strong` for solid faces with white text, coral for danger, `purple/40` focus rings); lucide icons only; 44 px tap targets; 16 px inputs with `inputMode`/`autoComplete`; tables collapse to cards under 768 px via `data-label`; modals are bottom sheets under `sm`; `aria-sort` on sortable headers; every icon-only button has an `aria-label`; loading, error and empty states come from `DataTable`; toasts via react-hot-toast.
10. **Sorting safety:** never pass `?ordering` straight to `order_by`. Every list goes through `apps/core/ordering.py apply_ordering` with an explicit whitelist and the `-pk` tiebreak. Kill the implicit `OrderingFilter` (see Phase 1).
11. **Tests never touch live Loyverse** (`backend/conftest.py` blanks the token). Mock `apps.cafeteria.services` HTTP calls.
12. **Do not build** anything the backlog explicitly retired: tuition/inscripción billing, SPEI, auto-recarga, self-service password reset, drag-and-drop rescheduling, rich text in announcements, an English locale.

# Contracts (design once, apply everywhere)

## C1. List contract (every admin list endpoint)

Create `backend/apps/core/listing.py` with:

- `class AdminListMixin`: `permission_classes = [IsAdmin]` (overridable), `filter_backends = []` (explicitly empty, to kill the implicit DRF `OrderingFilter`/`SearchFilter`), a `ListPagination(PageNumberPagination)` with `page_size = 20`, `page_size_query_param = 'page_size'`, `max_page_size = 100`.
- `search_fields: tuple[str, ...]` and `search_param = 'q'`. Also accept the legacy `search` param where it exists today (students, pre-registrations) for one release, then remove. Search builds `Q(field__icontains=term)` ORs; on Postgres, use `unaccent` + `icontains` through a `SearchLookup` helper guarded by `connection.vendor == 'postgresql'`.
- `ordering: dict[str, str]` whitelist (`{'name': 'user__last_name', 'date': 'created_at', ...}`) passed to `apply_ordering`, default declared per view.
- `filterset_class` from `django-filter` (already installed, unused) for entity filters. Date ranges are implemented once in `apps/core/listing.py` as `date_bounds(param_from, param_to)` returning aware `datetime` bounds in `America/Mexico_City`, and every existing `field__date__gte/lte` filter is rewritten to `field__gte=start`, `field__lt=end_exclusive`. Replace at: `apps/payments/views.py:327,330,442`, `apps/cafeteria/views.py:197,200,245,367,1067,1070,1512`, `apps/core/views.py:136,139`, `apps/core/dashboard.py:27`, `apps/portal/analytics.py:84`.
- Response shape stays DRF `{count, next, previous, results}`. Hand-rolled pagers (`staff_users.py`, `password_requests.py`, low-balance, customers) migrate to the mixin so the frontend can rely on one shape (`frontend/src/lib/pagination.ts toPaged` already normalises both; keep it).
- Query budget: every list view gets a `django_assert_num_queries` test parametrized over roster size, following `apps/accounts/test_query_budgets.py`. Add `select_related`/`prefetch_related` until the count is O(1) in rows.

Remove `DjangoFilterBackend, SearchFilter, OrderingFilter` from `DEFAULT_FILTER_BACKENDS` in `backend/config/settings/base.py` once every list is on the mixin, and set `DEFAULT_PAGINATION_CLASS` to `ListPagination`. Add `EXCEPTION_HANDLER` = `apps.core.exceptions.handler` that keeps DRF's `{detail}` and field-dict shapes and converts the ad-hoc `{'error': ...}` responses to `{detail}` by fixing the views that emit them (grep `{'error'`). Update `frontend` error mapping accordingly (C6).

## C2. Ordering contract (frontend ↔ API)

- URL param `orden` (frontend) ↔ `ordering` (API). Cycle: desc → asc → clear (`frontend/src/components/ui/SortableTh.tsx nextSort`). Delete the opposite cycle in `frontend/src/lib/rosterTable.ts` (`nextOrdering`, `sortIndicator`) and migrate AdminStudents to `SortableTh`.
- Every `Column` with a database mapping declares `sortKey`; the backend whitelist for that endpoint contains the same keys. Add a backend test that asserts the whitelist keys equal a constant exported for the frontend (keep a `docs/API-LISTING.md` table of endpoint → keys, filters, search fields, export formats).

## C3. Export contract

Create `backend/apps/core/exporting.py`:

- `class ExportSpec`: `filename_prefix`, `columns: list[Col]` where `Col(key, header, getter, width=None, fmt=None)`, `row_cap` (10,000 CSV/XLSX, 1,000 PDF), `audit_entity`.
- `render_csv(rows, spec)` → `StreamingHttpResponse` (UTF-8 BOM, CRLF, `text/csv; charset=utf-8`), using `export_filename(prefix, 'csv')` from `apps/core/exports.py`.
- `render_xlsx(rows, spec)` → `openpyxl` `Workbook(write_only=True)`, header row bold, frozen header, column widths from `Col.width`, dates as real dates, money as numbers with `#,##0.00` format, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- `render_pdf(rows, spec)` → extend `apps/core/pdf.py` with `table_pdf(title, headers, rows, *, subtitle, landscape=True)` (Courier fixed-width columns computed from `Col.width`, page numbers, "Generado DD/MM/YYYY HH:MM"). Keep the existing `simple_document_pdf` untouched for statements and receipts.
- Every list endpoint gets a sibling `GET .../export/?fmt=csv|xlsx|pdf&...same filters, q and ordering...` implemented by **subclassing the list view** (the pattern in `apps/core/views.py:254 AdminAuditExportView`) so filters, search and ordering are shared code, never duplicated. `?ids=1,2,3` (≤500) exports selected rows only.
- Audit every export with a new helper `apps/core/audit.py record_export(entity, fmt, filters, row_count, actor)` that writes an `AuditLog` with `object_type='export:<entity>'` (adapt `record()` to accept an explicit `object_type`/`object_id` when no instance is given). Replace the `rows[0]` hack in `apps/admissions/exports.py`.
- Throttle scope `admin-export` 30/min on export views via `SharedScopedRateThrottle`.
- Fix the known drift: `AdminPayments` must call a new `GET /api/v1/payments/admin/export/` (honours `q`, `gateway`, `status`, `student`, dates, `ordering`), not the family endpoint `/payments/history/export/` (`frontend/src/pages/admin/AdminPayments.tsx:72-76`). Student export must honour `estado`, `nivel`, `grado`, `grupo`, `acceso`, `q` and `ordering` (`apps/accounts/exports.py:45`). Parent cafetería export must honour its filters (`frontend/src/pages/parent/CafeteriaPage.tsx:273-285`). Registration export must accept `q` and `status`.
- Frontend: `frontend/src/components/admin/ExportMenu.tsx` becomes the only export UI. Extend it with options CSV / Excel / PDF, "Solo seleccionados (N)" when a selection exists, filename `{prefix}_{date}.{ext}`, a progress toast, and a 413 handler that shows the server message. Remove every hand-rolled export button (AdminPayments, AdminBookings, AdminStudents, AdminCafeteria, AdminForms).

## C4. Import contract

Create `backend/apps/core/importing.py`:

- `class ImportSpec`: `entity`, `columns: list[ImportCol]` where `ImportCol(key, header_aliases, required, parse, validators, example)`, `dedupe_keys: list[tuple[str, ...]]` (in-file), `db_match: callable(row) -> instance | None`, `max_rows = 2000`, `max_bytes = 5 MB`.
- `parse_upload(file) -> list[dict]`: CSV (`utf-8-sig`, then `latin-1` fallback, delimiter sniffed among `,;\t`) or XLSX (`openpyxl.load_workbook(read_only=True, data_only=True)`, first sheet). Header normalisation: lowercase, trim, accents stripped, spaces → `_`, matched against `header_aliases`. Missing required headers → 400 with `expected_headers` and the template link.
- `validate(rows, spec) -> ImportReport`: per-row `{line, key, action: 'crear'|'actualizar'|'omitir'|'error', errors: [str], warnings: [str], data}`. Duplicates inside the file (by `dedupe_keys`) mark the later row `error: 'Duplicado de la fila N'`. DB matches decide `crear` vs `actualizar`. Everything the commit would check must run in the dry-run (fix the current gap where the student dry-run skips the email-collision check).
- `commit(rows, spec, actor)`: `transaction.atomic()` outer, `savepoint` per row, broad `except Exception` isolates the row, `record()` per created/updated instance with `context='import:<entity>'`, one summary `record_export`-style entry for the import (`object_type='import:<entity>'`).
- `render_report(rows, fmt)`: returns the **original columns + `fila`, `resultado`, `errores`, `avisos`** as CSV or XLSX (same format as the upload by default). Rows with errors first.
- Endpoints per entity: `GET .../import/template/?fmt=csv|xlsx` (headers + one example row), `POST .../import/` multipart `file` with `dry_run=1` (default) or `0`, and `report=csv|xlsx` which returns the annotated file instead of JSON. Stateless: the client re-posts the same file to get the report. Throttle scope `admin-import` 10/min. Enforce `max_bytes` in the view (settings limits are not hard limits).
- Entities that get import in this round (in priority order): **students** (upgrade `apps/accounts/import_students.py` onto the spec: normalise matrícula with `_matricula`, match guardians with `email__iexact`, add XLSX, template, report, audit; keep the 4 required headers `matricula, nombre, apellidos, grado`), **cafetería ajustes masivos** (`matricula, monto, motivo` → `adjust_balance` per row, preview with resulting balances, cap 500, reject negative results; reuse `AdminBulkTopUpView` semantics), **calendario escolar** (`titulo, tipo, inicio, fin, nivel, descripcion, publicado`), **pre-registros** (fair sign-up sheets: `nombre_alumno, apellidos_alumno, fecha_nacimiento, nivel, grado, nombre_tutor, correo, telefono, origen`; duplicates warn, never block), **personal** (`correo, nombre, apellidos, rol` → invite flow), **redirecciones** (`de, a, permanente`), **horarios de visita** (`tipo, fecha, inicio, fin, cupo, lugar`, reuse the slot generator's `get_or_create`).
- Frontend: one generic `frontend/src/components/admin/ImportDialog.tsx` (replaces `ImportStudentsModal.tsx`): step 1 drop zone (native DnD + file input, accept `.csv,.xlsx`, size check client-side with the same 5 MB, "Descargar plantilla" CSV/Excel links); step 2 dry-run results in a `DataTable` with result chips (crear/actualizar/omitir/error), counts, "Descargar reporte de errores" (re-posts with `report=`); step 3 confirm (disabled while any `error` rows exist unless the person ticks "Importar solo las filas válidas"); step 4 summary with audit link. Bottom sheet on mobile.

## C5. Bulk action contract

Create `backend/apps/core/bulk.py` and `backend/apps/core/transitions.py`:

- `POST /api/v1/<app>/admin/<entity>/bulk/` body: `{"action": "<name>", "ids": [..≤500], "all_matching": false, "filters": {...}, "payload": {...}, "dry_run": false}`. With `all_matching: true` the server reuses the list view's filter function; if the match count exceeds 2,000 → 413; otherwise it processes in savepoint chunks of 100. Response: `{"action", "requested", "ok", "failed": [{"id", "error"}], "skipped": [{"id", "reason"}], "dry_run"}`. `dry_run` returns what would happen without side effects (the frontend shows it in the confirm dialog: "Se confirmarán 14 reservas; 2 se omitirán porque ya están canceladas").
- `class BulkAction`: `name`, `label_es`, `allowed_from: set[str] | None`, `requires_note: bool`, `handler(instance, payload, actor)`, `side_effects: 'per_row' | 'batched' | 'none'`. Per-row `select_for_update()`; per-row `record()`; one summary `record()` with counts. Throttle scope `admin-bulk` 30/min.
- `transitions.py` holds one table per entity and `assert_transition(entity, current, target)` raising a `ValidationError` with an es-MX message. Use these defaults (reverse transitions require a `note` in `payload` and are audited with it):
  - PreRegistration: pending → contacted | enrolled | rejected; contacted → enrolled | rejected | pending; rejected → pending; enrolled: terminal.
  - Registration: submitted → reviewing | approved | rejected; reviewing → approved | rejected | submitted; approved → complete (convert only) | reviewing; rejected → reviewing; draft and complete: only the existing family/convert paths.
  - Booking: pending → confirmed | cancelled | no_show | attended; confirmed → attended | no_show | cancelled; cancelled → pending (capacity re-check); attended ↔ no_show (correction, note required).
  - TopUpRequest: pending → completed | failed (apply); failed → pending (retry, note).
  - ArcoRequest: received → in_review | resolved | rejected; in_review → resolved | rejected; resolved | rejected → in_review (note).
  - PasswordRequest: open → resolved | rejected (existing guard).
  - Announcement: draft/inactive ↔ active (activate/deactivate); delete only when never fanned out (`fanout_at is None`).
  - Page: existing `publish()` / `unpublish()`; StudentProfile status: any → any among active/on_leave/graduated/withdrawn, but withdrawing surfaces the wallet balance (see Phase 6).
  Apply the same tables to the existing single-row endpoints (`PreRegistrationDetailView`, `RegistrationStatusView`, `AdminBookingActionView`, `AdminArcoStatusView`) so single and bulk cannot diverge, and add the missing `record()` calls there (booking confirm/cancel, admissions status changes, password-request reject, contact handled, announcement edits).
- Side effects: emails and notifications are sent per row through the existing services (`apps/portal/services.py send_email`, `notify`), but a bulk call passes `notify=payload.get('notify', True)` where the service supports it and the confirm dialog exposes "Notificar a las familias" as a checkbox. Google Calendar sync for bookings is per row (bounded by the 500 cap). Loyverse mirror stays as in `adjust_balance`. Booking confirm must lock the slot and check capacity by summing `num_attendees` exactly like `apps/bookings/services/booking.py create_booking` (fix the row-count bug in reschedule at the same time).
- Frontend: `frontend/src/components/admin/BulkActionBar.tsx` (appears when ≥1 row is selected: count, "Seleccionar las N que coinciden", actions as buttons/dropdown, "Exportar seleccionados", "Limpiar"), a `BulkConfirmDialog` that first calls `dry_run: true` and renders the plan, then commits and shows per-row failures in a list with "Reintentar fallidas". On mobile the bar is a bottom sheet and cards get a checkbox.

## C6. Frontend data layer

- `frontend/src/components/ui/DataTable.tsx` v2, same file, backwards compatible props plus: `tableId` (persisted prefs key `interlaken:table:<id>`), `selection?: {selected: Set<Key>, onChange, allMatchingCount?, onSelectAllMatching?}`, `toolbar?: ReactNode` (search + filters + export live here), `bulkBar?: ReactNode`, `columnControls?: boolean` (visibility popover, density toggle, "Restablecer"), `pinFirstColumn?: boolean` (CSS `position: sticky; left: 0`), `resizable?: boolean` (pointer-event handle on `th`, widths persisted, ≥ md only), `onRowClick?`, `stickyHeader` default true, `rowActions?: (row) => ReactNode` rendered in a last column with an overflow `Dropdown` on narrow widths. `Column` gains `id` (stable key; stop keying by `header`), `hideable`, `defaultHidden`, `width`, `minWidth`. Keep `data-label` cards under 768 px and give cards the selection checkbox and the row actions.
- New shared pieces in `frontend/src/components/admin/`: `SearchInput.tsx` (debounced, URL-synced via `useUrlSyncedSearch`, clear button, `aria-label`), `StatusTabs.tsx` (chip/tab filter with counts, URL-synced), `FilterBar.tsx` (composes `SearchInput`, `StatusTabs`, `DateRangeFilter`, selects, `ActiveFilterChips`), `BulkActionBar.tsx`, `BulkConfirmDialog.tsx`, `ImportDialog.tsx`, `ColumnControls.tsx`, `TablePrefs` hook `frontend/src/hooks/useTablePrefs.ts` (replaces `lib/rosterTable.ts` prefs; migrate the old `interlaken:roster-prefs` key once).
- Hooks layer `frontend/src/hooks/queries/<entity>.ts`: `useEntityList(params)`, `useEntityMutation(...)`, `useBulk(entity)`, `useExport(entity)`, `useImport(entity)` with standard query keys `['admin', entity, 'list', params]` and centralised invalidation. Pages stop inlining `useQuery`/`useMutation` for list data.
- One DRF error mapper `frontend/src/lib/apiErrors.ts` (`{detail}`, `{error}`, field dicts, 413 messages) replacing `cms/editor/helpers.ts apiErrors()` and `StudentFormModal.tsx fieldErrorsFrom()`.
- URL param vocabulary (frontend → API): `q`→`q`, `orden`→`ordering`, `page`→`page`, `estado`→`status`, `tipo`→`type`, `desde`/`hasta`→`from`/`to`, `nivel`, `grado`, `grupo`, `pasarela`→`gateway`, `alumno`→`student`. Every list page uses `useUrlFilters`; no list filter lives in `useState` after this round.
- Status label/variant maps: one module `frontend/src/lib/status/<entity>.ts` per entity (extend `lib/admissionsStatus.ts`, `lib/studentStatus.ts`), used by tables, chips, bulk dialogs and the bitácora of results.
- Tests for every shared piece: `DataTable` (render, sort click cycle, selection incl. select-all-matching, column visibility persistence, density, cards under 768 px with a matchMedia stub), `SearchInput`, `StatusTabs`, `ExportMenu` (formats, selected-only, 413), `ImportDialog` (template links, dry-run table, error report download, valid-only commit), `BulkActionBar`/`BulkConfirmDialog` (dry-run plan, per-row failures), `useTablePrefs`, `useUrlFilters`, `apiErrors`.

# Phases (one PR each, in this order)

**Phase 0 comes first:** ship Part C of `docs/DATA-OPS-PROMPT.md` (`fix/loyverse-roster-sync`) before Phase 1. Phase 6 assumes its serializer field `loyverse_code`, the `services.sync_roster()` extraction and the diff-preview report shape exist.

## Phase 1: backend foundation (`feat/data-ops-1-api-foundation`)

Deliver `apps/core/listing.py`, `exporting.py`, `importing.py`, `bulk.py`, `transitions.py`, `exceptions.py`, the `record_export` helper and the `admin-export`/`admin-import`/`admin-bulk` throttle scopes; `openpyxl` in requirements; `page_size_query_param`; the `unaccent`/`pg_trgm` guarded migration in `apps/core/migrations/` (`RunPython` that executes `CREATE EXTENSION IF NOT EXISTS` only when `schema_editor.connection.vendor == 'postgresql'`, reversible noop); the date-bounds rewrite at every `__date` site listed above; the index migration below; `Meta.ordering = ['student__user__last_name', 'student__user__first_name', 'pk']` on `CafeteriaBalance` and removal of the pagination warning filter from `backend/pytest.ini`; `apps/core/pdf.py table_pdf`. Unit tests for each module (parsers with CSV/XLSX/latin-1/semicolon inputs, dedupe, report rendering, caps → 413, transitions table, bulk dry-run and per-row isolation, export renderers, `date_bounds` around DST and month ends).

Index migration (one per app, `AddIndex` and functional indexes only, no `AddIndexConcurrently`):
- admissions: `PreRegistration (status, -created_at)`, `Lower('parent_email')`; `Registration (status, -updated_at)`, `(status, -created_at)`, `Lower('parent1_email')`, `Lower('parent2_email')`, `child_curp`.
- core: `ContactMessage (is_handled, -created_at)`; `AuditLog (action, -created_at)`; Postgres-only trigram GIN on `AuditLog.context` and `actor_label` (guarded).
- content: `FormSubmission (form, is_handled, -created_at)`.
- legal: `ArcoRequest (status, -created_at)`.
- cafeteria: `TopUpRequest (status, -created_at)`, `CafeteriaTransaction date`, `UnmatchedReceipt resolved_at`, `LoyverseProfile customer_code`, `BalanceAdjustment created_at`; `CheckConstraint(amount > 0)` on `TopUpRequest`, `CheckConstraint(balance >= 0)` on `CafeteriaBalance`.
- payments: `Payment created_at`.
- accounts: partial `UniqueConstraint(fields=['loyverse_id'], condition=~Q(loyverse_id=''))` on `StudentProfile` **only after** a management command `check_data_integrity` reports zero duplicates (ship the command in this phase; ship the constraint in Phase 10 if clean). Same for `UniqueConstraint(Lower('email'))` on `User` (report case-duplicates; the merge tool `apps/accounts/merge.py` is the cleanup path).
- Fix the `''` receipt-id collision: generate the synthetic reference **before** insert in `adjust_balance` and `refund_transaction` (`apps/cafeteria/services.py:1193-1205`) using the pre-allocated pk pattern or a uuid, and add a concurrency test that inserts two adjustments for different students in one transaction.

## Phase 2: frontend foundation (`feat/data-ops-2-ui-foundation`)

Deliver DataTable v2, the shared components, the hooks layer scaffold, `useTablePrefs`, `apiErrors`, the ExportMenu v2, the ImportDialog, the BulkActionBar/BulkConfirmDialog, the SW NetworkOnly rule, and the tests listed in C6. Migrate **AdminAudit** and **AdminPayments** (already on DataTable with server sort) to the new toolbar, column controls and ExportMenu v2 as the reference implementation. No other page changes in this PR. Budgets must stay green; report chunk sizes before/after.

## Phase 3: Alumnos, Usuarios, Contraseñas (`feat/data-ops-3-people`)

- Students list (`apps/accounts/views.py StudentListView`) onto the list contract: `q` (keep `search` alias), ordering keys `name, student_id, grade, group, status, last_login, enrollment_date, balance` (annotate balance via `CafeteriaBalance`), filters via FilterSet (`status, access, level, grade, group`), export CSV/XLSX/PDF honouring everything, `?ids=`. Bulk actions: `status` (withdrawing returns a warning list of students with `CafeteriaBalance.balance > 0` in dry-run), `grade`, `group` (offer the groups that exist in the data plus free text, not hardcoded A/B/C), `sync_loyverse`, `export`. Add **archive** semantics instead of delete: `withdrawn` is the archive; no hard delete of students. Guardians sub-list gets sort and search. Import per C4 (students). `AdminStudents.tsx` moves onto DataTable v2 (remove the hand-rolled table and mobile list, `rosterTable.ts` prefs and sort helpers); the 2xl two-pane detail stays.
- Staff users (`apps/accounts/staff_users.py`) onto the list contract: `q` (email, names), ordering `name, email, role, is_active, last_login`, filters `role, active`; bulk `deactivate`/`reactivate` (keeps the last-active-admin guard per row), export, import (invite). Empty state. No delete (deactivate is the archive).
- Password requests (`apps/accounts/password_requests.py`): `q` (requested_email, requester_name), ordering `created_at, status, requested_email`, status filter moved to the URL; bulk `reject` (note required); `resolve` stays single-row (it generates a password). Export.

## Phase 4: Admisiones (`feat/data-ops-4-admissions`)

- Pre-registrations (`apps/admissions/views.py:78`): `q` over child names, parent name, email, phone; ordering `created_at, child, level, grade, status, parent`; filters `status, level, cycle, wants_visit, dates`; export CSV/XLSX/PDF with `q`+filters; bulk `set_status` (with note), `invite`, `export`; single-row PATCH goes through `assert_transition` + `record()`. Import per C4. Fix the stale `cycle` default: use `current_school_cycle()` at creation.
- Registrations (`apps/admissions/views.py:211`): add `q` (child names, curp, parent emails, phones) and filters `status, level, cycle, documents_pending`; ordering `created_at, updated_at, child, level, status`; export honours them; bulk `approve`/`reject`/`reviewing` (note, optional notify), `request_docs`; `RegistrationStatusView` gets transition guard + audit. Documents: bulk verify/reject inside the review modal.
- Pipeline: bound the query to non-terminal statuses plus the last 90 days of `complete`, with a "Ver todos" link to the list.
- `AdminAdmissions.tsx`: both sections on DataTable v2 with URL state, `ImportDialog`, `BulkActionBar`; delete the bespoke mobile lists.

## Phase 5: Visitas (`feat/data-ops-5-bookings`)

- Bookings list (`apps/bookings/views.py:224-259`): UI sends `q` and `date`; ordering `date, status, parent, child, created_at, attendees`; filters `type, status, dates, source`; export CSV/XLSX/PDF; bulk `confirm` (slot lock + capacity by `num_attendees`), `cancel`, `attended`, `no_show`, `export`; add the `no_show` action to the list rows (it exists only in the week view). `AdminBookingActionView` gains transition guard + capacity check + `record()`.
- Slots: list contract (`q` on title/location, ordering `date, start, type, capacity, booked`), bulk `activate`/`deactivate`/`delete` (refuse booked, report per row), import per C4.
- `AdminBookings.tsx` onto DataTable v2; all filter state to the URL.

## Phase 6: Cafetería (`feat/data-ops-6-cafeteria`)

- Balances (`apps/cafeteria/views.py:764`): real server search (`q` over student names, matrícula, guardian email), ordering `student, grade, balance, last_synced, threshold, spend_30d`, filters `grade, group, status, low_balance, unlinked`, export honouring filters (replace the "whole school" export button with ExportMenu v2 plus a "Toda la escuela" preset), bulk `sync`, `set_threshold`, `export`, and "Ajuste masivo" via the import dialog (C4 cafetería). Deterministic ordering (Phase 1).
- Transactions admin view (all students): `q` (student, matrícula, description, receipt id), ordering already whitelisted; add `type, dates, student` filters via FilterSet; export CSV/XLSX/PDF with filters; keep refund single-row with the type-to-confirm dialog. Paginate `AdminCafeteriaStudent` transactions and adjustments.
- Top-ups log (`:1033`): `q` (student, matrícula, payment_ref), ordering `created_at, amount, status, method, student`, filters `status, method, dates, needs_pos, needs_unload`; export; bulk `apply` (office + pending only, per-row `add_points_to_customer`, cap 500, dry-run shows total MXN), `pos_loaded`, `pos_unloaded`.
- Low balance, Loyverse customers, reconciliation: list contract (search, sort, filters in URL), export; customers page size honours `page_size` instead of the hardcoded 50; reconciliation bulk `fix` for selected rows.
- `AdminCafeteria.tsx` tabs on DataTable v2 with the shared toolbar; remove per-tab hand-rolled search and pagers.

## Phase 7: Pagos, Auditoría, Mensajes, ARCO (`feat/data-ops-7-money-audit-inbox`)

- Payments: admin export endpoint (C3), `q` extended to `gateway_ref`, filters `status, gateway, student, dates, type`; ordering `date, amount, status, gateway, student`; bulk is **export only** (state belongs to webhooks). Summary card unchanged.
- Audit: fix `?ordering=actor` to sort by `actor__email`; expose `object_type`, `object_id`, `context` filters in the UI; `q` over `actor_label, context, object_id`; trigram index (Phase 1) makes it usable; export CSV/XLSX honouring sort; diff view for `changes` in a row drawer (closes BACKLOG P4-8).
- Contact inbox: ordering `created_at, name, subject, handled`, bulk `mark_handled`/`reopen`, export, `record()` on handled.
- ARCO: `q` (requester email, name, details), ordering `created_at, deadline, status, type`, overdue computed server-side (`is_overdue` annotation) so the banner counts the whole set, error state on the page, bulk `in_review`; resolve/reject stay single-row (note required) with transition guard.

## Phase 8: Comunicados y Contenido (`feat/data-ops-8-content`)

- Announcements: `q` (title, body), filters `audience, active, scheduled, requires_ack`, ordering `created_at, publish_at, title, audience, reads`; bulk `activate`/`deactivate` (archive), `delete` (never fanned out only), `duplicate`; export CSV/XLSX; delivery report export; `record()` on create/update/delete.
- Pages, media, forms, redirects, testimonials, calendar: all onto the list contract with pagination (page size 20, `page_size` up to 100), `q`, ordering, export; bulk `delete` (pages: drafts only; media: unreferenced only, compute references from page blocks; forms: no submissions only; redirects, testimonials, calendar: free), `publish`/`unpublish` for pages and testimonials/calendar `is_published`; form submissions paginated with `q`, `handled`, bulk `mark_handled`/`delete`, export CSV/XLSX; media upload gets native drag-and-drop, per-file result list (size/type errors shown, not dropped silently), duplicate detection by `sha256` with "Ya existe: usar el existente"; calendar gets `.ics` export (`GET /api/v1/content/calendar.ics` for published events, reuse `apps/bookings/services/ics.py` building blocks); imports per C4 (calendar, redirects).

## Phase 9: Portal de familias (`feat/data-ops-9-portal`)

- Cafetería history: sort UI on the four whitelisted keys, filters in the URL, export honouring filters, monthly PDF unchanged.
- Payments: `DateRangeFilter` instead of raw inputs, sort, export honouring filters (already does), receipt unchanged.
- Comunicados/Notificaciones/Inscripciones: URL-synced page and filters, empty/error states, "Marcar todo como leído" stays.
- No bulk actions and no imports in the portal.

## Phase 10: engine tightening (`perf/data-ops-10-engine`)

- Query budgets: every admin list and export has a `django_assert_num_queries` test; fix N+1 (`parent_family_statement_csv` one query per child; announcement counts; pipeline prefetch).
- Postgres verification: run `EXPLAIN (ANALYZE, BUFFERS)` on a Postgres database seeded with a realistic volume (a management command `seed_perf_data --students 400 --transactions 80000 --audit 250000`) for: students list sorted by balance, cafetería transactions by date range, audit search, payments list, pre-registrations by status. Paste the plans in the PR; every plan uses an index.
- Ship the partial unique constraints from Phase 1 if `check_data_integrity` is clean in production (run it read-only via `docker compose exec` and paste the output; if not clean, open a follow-up with the exact duplicates).
- Remove dead code: `frontend/src/lib/rosterTable.ts`, `ImportStudentsModal.tsx`, hand-rolled search inputs, per-page status maps, bespoke mobile lists, the second error mapper, hand-rolled pagers, local permission duplicates, the old `search` param alias.
- Contracts: `docs/API-LISTING.md` (endpoint → search fields, ordering keys, filters, export formats, bulk actions, import spec), `docs/OPS-RUNBOOK.md` (new section "Importaciones y exportaciones": caps, throttles, how to read the error report, what is audited), `docs/UAT.md` (steps for import, bulk, export per page), `docs/BACKLOG.md` decision log (XLSX reinstated; bulk contract; caps), `frontend/BRAND.md` if new tokens were needed (they should not be).
- Playwright: one E2E flow in `frontend/e2e/admin.spec.ts`: import 3 students from CSV (one duplicate, one invalid) → download error report → commit valid → select two → bulk change group → export XLSX. Visual baselines for public pages must be byte-identical (this round touches no public route).
- Final report: full capability matrix (every page × every capability = Y or n/a with a one-line reason), Lighthouse desktop/mobile numbers, chunk sizes, test counts, and the list of follow-ups.

# Acceptance criteria (definition of done for the round)

1. Every row in this matrix is Y or "n/a + reason" in the final report:

| Page | Search | Sort all cols | Filters in URL | Select + bulk | Export CSV/XLSX/PDF | Import | CRUD | Workflow actions guarded + audited | Column controls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Alumnos | Y | Y | Y | Y | Y | Y | Y (archive = withdrawn) | Y | Y |
| Usuarios | Y | Y | Y | Y | Y | Y (invite) | Y (deactivate) | Y | Y |
| Contraseñas | Y | Y | Y | Y (reject) | Y | n/a | Y | Y | Y |
| Admisiones: pre-registros | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Admisiones: inscripciones | Y | Y | Y | Y | Y | n/a | Y | Y | Y |
| Visitas: reservas | Y | Y | Y | Y | Y | n/a | Y | Y | Y |
| Visitas: horarios | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Cafetería: saldos | Y | Y | Y | Y | Y | Y (ajustes) | n/a | Y | Y |
| Cafetería: transacciones | Y | Y | Y | export only | Y | n/a | n/a | refund single | Y |
| Cafetería: depósitos/POS | Y | Y | Y | Y | Y | n/a | n/a | Y | Y |
| Cafetería: saldo bajo / clientes / reconciliación | Y | Y | Y | Y (fix) | Y | n/a | n/a | Y | Y |
| Pagos | Y | Y | Y | export only | Y | n/a | n/a | n/a (webhooks) | Y |
| Auditoría | Y | Y | Y | n/a | Y | n/a | n/a | n/a | Y |
| Mensajes | Y | Y | Y | Y | Y | n/a | n/a | Y | Y |
| ARCO | Y | Y | Y | Y (in_review) | Y | n/a | Y (intake) | Y | Y |
| Comunicados | Y | Y | Y | Y | Y | n/a | Y | Y | Y |
| Contenido: páginas, medios, formularios, envíos, redirecciones, testimonios, calendario | Y | Y | Y | Y | Y | Y (calendario, redirecciones) | Y | Y | Y |
| Portal: pagos, cafetería, comunicados, notificaciones | n/a | Y | Y | n/a | Y (pagos, cafetería) | n/a | n/a | existing | n/a |

2. Every list endpoint: whitelisted ordering with `-pk` tiebreak, `q`, FilterSet, `page_size` ≤ 100, O(1) query count, date filters as aware bounds. `DEFAULT_FILTER_BACKENDS` is empty. No view returns `{'error': ...}`.
3. Every export: streams or renders within the cap, honours the current view, is audited, is throttled, is NetworkOnly in the service worker, and opens correctly in Excel es-MX (BOM for CSV, real types for XLSX).
4. Every import: template download, dry-run identical to commit, in-file and DB dedupe, error report in the upload's format, per-row audit, caps enforced in the view, ≤ 20 s for 2,000 rows in a test with mocked external services.
5. Every bulk action: transition table enforced for single and bulk paths, dry-run plan in the confirm dialog, per-row result, per-row audit + summary, cap 500, throttled, "select all matching" bounded at 2,000.
6. Accessibility: `aria-sort`, `aria-selected`/`aria-checked` on selectable rows, focus management in dialogs, 44 px targets, keyboard-only path through select → bulk → confirm verified in a test.
7. All gates green on every PR; no budget or SW config changed except the NetworkOnly rule; visual baselines unchanged.
8. Docs updated as listed in Phase 10.

# Things you will be tempted to do; do not

- Do not introduce TanStack Table "because it is standard". The budget and the existing CSS card mode are the reason.
- Do not generate XLSX or parse CSV in the browser. The server owns parsing, validation and rendering.
- Do not add a job table "for later". Caps and throttles are the design.
- Do not use `.update()` or `bulk_update()` on audited models in bulk paths.
- Do not rename URL params the family portal already uses; alias, then remove in Phase 10.
- Do not touch public routes, the login page, the PWA config beyond the NetworkOnly rule, or the Loyverse sync commands.
- Do not "fix" the Django admin. It stays read-only for people and money.

```
END PROMPT
```
---

## Part C: client report of 2026-09-24, Loyverse roster edits not reflected (Phase 0)

This is a production defect reported by the school on 2026-09-24 and verified read-only on the VPS the same day. It ships **before** Phase 1 as its own PR (`fix/loyverse-roster-sync`), because Phase 6 (Cafetería) builds on the same modules. Part C is self-contained; paste the block between `BEGIN PHASE 0 PROMPT` and `END PHASE 0 PROMPT` into a session at the repo root.

### C1. What the client reported, in plain terms

The office compares Loyverse with the app student by student. Balances match. What does not match is the roster identity, because the office now edits students in Loyverse this way and treats Loyverse as the master record:

1. **Customer name** gets the grade code as a suffix: "Alejandro Alvarado" becomes "Alejandro Alvarado-1SEC". The office uses the suffix to see at a glance who is still a student and in which grade.
2. **Customer code (matrícula)** gets a `ci` prefix: "09932" becomes "ci09932". Loyverse's bulk import (carga masiva) had dropped the leading zero, the QR/barcode stopped matching at the register and families could not pay; with the `ci` prefix everything works again.
3. Those edits **do not show up in the app**.

### C2. What the code and the server actually show (evidence, 2026-09-24)

- **The Loyverse snapshot is fresh.** All 350 student customers in `LoyverseProfile` carry the `ci` prefix and a grade suffix; `synced_at` is 2026-09-25 02:16 UTC. The snapshot is refreshed by `refresh_profiles_if_stale(max_age_hours=20)` (`backend/apps/cafeteria/loyverse_profile.py:229`, called from `sync_balances`) and by the `customers.update` webhook (`backend/apps/cafeteria/views.py:596-633`, which calls `refresh_all_profiles`).
- **The credencial code is already right.** `MyCardsView` (`backend/apps/cafeteria/views.py:428-470`) uses `LoyverseProfile.customer_code` (`ci09932`) as the barcode/QR payload, falling back to `student_id`; `frontend/src/components/portal/StudentCard.tsx` renders Code128 + QR from it. That is why families can pay, exactly as the client says.
- **The app deliberately stores a different spelling.** `StudentProfile.student_id` holds canonical digits (`09932`) because `_matricula()` strips `ci` (`backend/apps/cafeteria/services.py:2008`), and `User.first_name/last_name` hold the name without the suffix (`_strip_grade_suffix`, `services.py:1998-2004`, `_split_loyverse_name`, `services.py:2016`). Production example: the app shows "Juan Antonio Chavez Lopez", matrícula 09932, 4° Primaria A; Loyverse has "Chavez Lopez Juan Antonio-4PRI", `ci09932`, address `4PRI`. The office reads that as "not updated".
- **The only automatic roster refresh has never run.** `sync_roster` (`backend/apps/cafeteria/management/commands/sync_roster.py`) links, imports (refreshing name/grade/group) and replays receipts. It is scheduled `5 6 * * *` (`deploy/crontab.example:47`, same in the live crontab) with `flock -n /tmp/interlaken-loyverse.lock`. The 5-minute job (`crontab.example:25`) uses the **same lock file, also with `flock -n`**, and fires at 06:05:00 too. The 5-minute job wins (the log shows its "Opening-balance seed complete" at 06:05:29), and `flock -n` makes `sync_roster` exit silently. The 11 MB `/var/log/interlaken/loyverse.log` has **no** `sync_roster` line, and `LoyverseSyncState.last_full_fetch_at` is null. The 05:40 job `sync_purchases --since-days 7` (`crontab.example:44`) has the same collision.
- **No alarm covers it.** `check_sync_fresh` measures only `last_poll_at` (`backend/apps/cafeteria/management/commands/check_sync_fresh.py:9,32`). `SyncHealthPanel.tsx` has no roster light.
- **The manual path is opaque.** "Importar desde Loyverse" (`frontend/src/components/admin/ImportLoyverseModal.tsx`, `POST /api/v1/accounts/admin/import-loyverse/`) does refresh names and grades on commit, but its preview shows counts plus 10 samples, not per-student before/after, so the office cannot see what a commit will change.
- **Side risks in the same path.** `import_students_from_loyverse` (`services.py:2031`) re-splits and overwrites every existing student's first/last name on every run (`services.py:2094-2098`), so a correction made in the console is clobbered on the next sync, and a two-word Loyverse name written nombre-apellido is inverted by the apellidos-first heuristic. A bare grade code (`4PRI`) leaves the app's group letter untouched (correct, undocumented). `_is_loyverse_student` (`services.py:1969`) requires the `ci<digits>@interlaken.com.mx` email, so a customer whose email the office edited is silently counted as `skipped_non_student` with no per-customer reason. Leavers: `link_students_to_loyverse` already lists active students with no Loyverse customer as `unmatched_students` for the baja flow (`services.py:1900-1914`), but nothing flags an ex-student the office keeps in Loyverse and merely strips the suffix from.

### C3. Decisions (do not re-litigate)

1. **Loyverse stays the master for roster identity** (customer code, name, grade code). The app keeps `student_id` as canonical digits internally (unique key, CSV import key) but **displays the Loyverse code exactly as Loyverse writes it** (`ci09932`) everywhere the office compares with Loyverse, labelled "Código Loyverse", and every search and import accepts both spellings.
2. **Names display as "Nombre Apellidos"** in the app (families see it too). The sync rewrites a name only when the Loyverse name changed since the previous snapshot, so console corrections survive.
3. **Grade and group come from the Loyverse grade code** (`4PRI`, `4APRI`, or the name suffix). A group letter is applied only when the code carries one.
4. **No automatic baja.** The sync flags "posible baja"; the office confirms through the existing Vincular Loyverse → Dar de baja flow.
5. **Daily Loyverse jobs move off the 5-minute grid and wait for the lock** instead of giving up.

```
BEGIN PHASE 0 PROMPT
```

# Phase 0: `fix/loyverse-roster-sync`

You are working in `D:\Github\interlaken` (Django 6.1 + DRF backend in `backend/`, React 18 + Vite frontend in `frontend/`, cron-driven jobs on a VPS, no Celery). Read `docs/DATA-OPS-PROMPT.md` Part C sections C1 to C3 first; they hold the client report, the evidence and the decisions. Verify every line reference before editing (they drift). Follow the working method and hard constraints of Part B (one PR, Conventional Commits, all gates green, tests with the change, es-MX copy, no new dependencies, audit on state changes, tests never touch live Loyverse).

## Tasks

1. **Fix the cron collision.** In `deploy/crontab.example`: move `sync_roster` to `7 6 * * *` and `sync_purchases --since-days 7` to `42 5 * * *`, and change both from `flock -n` to `flock -w 900` so a daily job waits for the 5-minute job instead of exiting. Keep every other line intact. Add a test `backend/apps/cafeteria/test_crontab.py` that parses `deploy/crontab.example` and fails if two entries that share a lock file can fire in the same minute, or if any daily job on a shared lock uses `-n`. Document in `docs/OPS-RUNBOOK.md` and `docs/DEPLOY_HOSTINGER_VPS.md` how the live crontab is installed from the example (find the current procedure; if it is manual, write the exact `crontab` command) and add a one-line release note that the live crontab must be reinstalled with this deploy.

2. **Make the roster sync observable.** Add `LoyverseSyncState.last_roster_sync_at` (migration). `sync_roster` stamps it on success and writes one summary `apps.core.audit.record` entry with `context='system:sync_roster'` and the counts. `check_sync_fresh` gains a second check: roster sync older than 30 hours → same alert mechanism as the poll check, message "El roster no se ha sincronizado con Loyverse desde …". `sync_health()` (`backend/apps/cafeteria/services.py`, near line 1827) and `AdminSyncHealthView` return `last_roster_sync_at`. `frontend/src/components/admin/SyncHealthPanel.tsx` shows a "Roster" light: ok = "Roster sincronizado hace X", bad = "El roster no se ha sincronizado desde X" with the cron hint, plus a button **"Sincronizar roster ahora"**.

3. **On-demand roster sync endpoint.** `POST /api/v1/cafeteria/admin/sync-roster/` (IsAdmin, throttle scope `admin-bulk` 30/min, body `{dry_run: bool}`) runs the same three steps as the command (link → import → replay) and returns the combined report. It must finish inside the 60 s gunicorn timeout: one `get_all_customers()` fetch plus ~400 row updates; add a test with a mocked customer list of 500 that asserts it completes without external calls. Reuse the code: extract the body of `sync_roster.handle` into `services.sync_roster(customers, *, commit)` and call it from both the command and the view.

4. **Display the Loyverse code.** Add `loyverse_code` to the student serializers used by the console roster (`backend/apps/accounts/serializers.py`, the roster list and detail), the cafetería balances serializer and the link report: value = `LoyverseProfile.customer_code` when linked, else `student_id`. Show it as "Código Loyverse" in `frontend/src/pages/admin/AdminStudents.tsx` (new hideable column next to Matrícula, and in the mobile card), `frontend/src/pages/admin/AdminStudentDetail.tsx` (in the identity block), `frontend/src/pages/admin/AdminCafeteria.tsx` (Saldos and Saldo bajo tables) and `frontend/src/components/admin/LinkLoyverseModal.tsx`. Keep "Matrícula" as the canonical digits. In the credencial the label above the barcode becomes "Código Loyverse" (`frontend/src/components/portal/StudentCard.tsx`).

5. **Accept both spellings everywhere.** Students `search` (`backend/apps/accounts/views.py` `StudentListView`), cafetería balances search (make it server-side in this PR for the matrícula only if the full Phase 6 search is not yet there: `?q=` matched against `student_id` and `loyverse_profile__customer_code`), Loyverse customers `q`, and the CSV student importer (`backend/apps/accounts/import_students.py`: run `_matricula()` on the `matricula` column before the in-file dedupe and the DB match) must treat `ci09932` and `09932` as the same key. Add tests for each.

6. **Name and grade refresh semantics.** In `import_students_from_loyverse`: compute `incoming_name = _strip_grade_suffix(customer.name)` and `previous_name = _strip_grade_suffix(LoyverseProfile.name)` from the stored snapshot (before this run refreshes it). Rewrite `User.first_name/last_name` **only when** `incoming_name != previous_name` (or when no snapshot exists and the stored user name is empty); when rewriting, `record('update', user, {'first_name': [old, new], 'last_name': [old, new]}, context='import:loyverse')`. Always update `grade` from the code when present; update `group` only when the code carries a letter; keep `'N/D'` only on create. Add `skipped: [{customer_code, name, reason}]` (cap 200) to the report with es-MX reasons ("correo no tiene la forma ci…@interlaken.com.mx", "código no numérico", "matrícula duplicada en Loyverse"). Tests: name unchanged → user untouched after a console correction; name changed → updated and audited; two-word name; `4PRI` keeps group; `4APRI` sets group; skip reasons.

7. **Preview diffs.** `import_students_from_loyverse` and `link_students_to_loyverse` return `changes: [{matricula, name, field, before, after}]` (cap 500 rows, fields `nombre`, `grado`, `grupo`, `codigo`, `vinculo`). `ImportLoyverseModal.tsx` replaces the 10-sample list with a `DataTable` of the diffs (search box, filter chips by field, counts per field) shown before "Importar"; the summary line keeps the counts. Test the modal with a mocked report of 30 changes.

8. **"Posible baja" signal.** In `link_students_to_loyverse`, when a linked customer has neither an `address` grade code nor a name suffix, add the student to `possible_leavers: [{id, matricula, name, grade, balance}]` (same shape as `unmatched_students`). `LinkLoyverseModal.tsx` shows it as a second group under "Dar de baja" titled "Sin grado en Loyverse (posible baja)", using the same bulk-status action. No automatic status change. Test it.

9. **Docs and copy.** `docs/OPS-RUNBOOK.md`: new subsection "Qué pasa cuando la oficina edita en Loyverse" (code, name suffix, grade code, timing: 5 minutes for balances and snapshots, daily 06:07 for the roster, or the button). `docs/UAT.md`: steps to verify the roster light, the button and the Código Loyverse column. A 6-line es-MX note for the office in the PR description, ready to paste into WhatsApp.

10. **Deploy and verify** (paste outputs in the PR): after deploy, reinstall the crontab; run `docker compose exec -T app python manage.py sync_roster --dry-run`, then the real run; confirm in the console that student 09932 shows Código Loyverse `ci09932` and the grade from Loyverse; confirm the log line `sync_roster (written): …` exists; the next morning confirm the Roster light is green and `last_roster_sync_at` is stamped.

## Questions to confirm with the school (put them in the PR description; do not block on them)

- When a student leaves, does the office delete the Loyverse customer, or keep it and remove the grade suffix? (Decides whether "posible baja" should look at the missing suffix, the missing customer, or both.)
- Are Loyverse names always written apellidos first ("Chavez Lopez Juan Antonio")? (Decides whether the apellidos-first split can stay the only rule.)

## Acceptance

- `sync_roster` runs daily, its log line exists, `last_roster_sync_at` is stamped, the Roster light is green, and the alarm fires when it is 30 h stale.
- The office sees `ci09932` under "Código Loyverse" in the roster, the student page, Cafetería and the credencial, while Matrícula stays `09932`; searching either spelling finds the student; the CSV importer treats both as one key.
- A name corrected in the console survives the next sync unless the office changes the name in Loyverse; grade follows the Loyverse code.
- The import preview lists exactly what will change per student before commit.
- All backend and frontend gates green; no budget or service-worker config change.

```
END PHASE 0 PROMPT
```
