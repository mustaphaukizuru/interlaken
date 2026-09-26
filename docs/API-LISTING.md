# Admin list endpoints: search, ordering, filters, export, bulk, import

One table per list endpoint of the Data Ops round (`docs/DATA-OPS-PROMPT.md`, contracts C1 to C5), grouped by area in admin sidebar order, with the family portal last. Base path `/api/v1`; permission `IsAdmin` unless a section says otherwise. Sections were first written by Phases 3 to 9 and made uniform in Phase 10.

## Shared contract

These rules hold for every list below; the per-endpoint tables only state what differs.

- **List** (`apps/core/listing.py`, `AdminListMixin`): `?q=` searches the listed fields (every term must match one of them; case-insensitive, and accent-insensitive on PostgreSQL); `?ordering=[-]<key>` accepts only the whitelisted keys, an unknown key falls back to the default, and `-pk` is always appended as the tiebreak; `?page=` and `?page_size=` (up to 100). Envelope `{count, next, previous, results}` plus any extra keys named below. Date filters `from` / `to` are inclusive days in America/Mexico_City unless noted.
- **Errors**: `{"detail": "..."}`, plus `code` when a client branches on a machine code (for example OAuth `not_invited`, webhook `invalid_signature`); serializer errors keep the DRF `{field: [msg]}` shape. Since Phase 10 no response carries the old `error` key (`LEGACY_ERROR_KEY = False` in `apps/core/exceptions.py`).
- **Export** (`apps/core/exporting.py`): `GET <list>/export/?fmt=csv|xlsx|pdf` with the same `q`, filters and `ordering` as the list, plus `ids=1,2,3` (up to 500) for "Solo seleccionados". CSV is UTF-8 with BOM; XLSX carries real dates and numbers. Caps: 10,000 rows for CSV and XLSX, 1,000 for PDF. Throttle `admin-export` (30/min). Audited as `export:<entity>` with the filters and the row count.
- **Bulk** (`apps/core/bulk.py`): `POST <list>/bulk/` with `{action, ids, all_matching, filters, payload, dry_run}`; answer `{action, requested, ok, failed: [{id, error}], skipped: [{id, reason}], dry_run}`. `ids` up to 500 per call; `all_matching` re-runs the list's own filter pipeline and is capped at 2,000 matches. `dry_run` runs only the transition guard and the action's plan, which feeds the confirm dialog. Rows run in chunks of 100 under `select_for_update`, one savepoint per row. Throttle `admin-bulk` (30/min). Audited per row as `bulk:<entity>:<action>` plus one `bulk:<entity>` summary.
- **Import** (`apps/core/importing.py`): `GET <list>/import/template/?fmt=csv|xlsx` (headers plus one example row); `POST <list>/import/` multipart `file` (CSV or XLSX, first sheet) with `dry_run=1` (default) for the preview, `report=csv|xlsx` for the annotated error report (original columns plus `fila`, `resultado`, `errores`, `avisos`) and `dry_run=0` to commit. A commit with error rows is refused unless `only_valid=1` (the console sends `valid_only=1`; both are accepted), which is "Importar solo las filas válidas". Row actions `crear` / `actualizar` / `omitir` / `error`; an in-file duplicate marks the later row. Header matching ignores accents, case and spaces. Caps: 2,000 rows (413 "Divida el archivo: el límite es 2,000 filas.") and 5 MB (413 "El archivo excede el límite de 5 MB."). Throttle `admin-import` (10/min). Audited per row as `import:<entity>` plus one import summary.
- **413 body** for every row or id cap: `{"detail": "Acote los filtros: el límite es N filas."}` (es-MX thousands separator). The console shows it verbatim.
- **Portal exports**: CSV and XLSX only, 10,000 rows, throttle `portal-export` (30/min per user), audited with `context='portal'`.
- **Removed in Phase 10**: the legacy `search` query alias (only `q` is read), the reconciliation `limit` / `offset` query aliases (use `page` / `page_size`), and `GET /cafeteria/admin/export/school/` (the console uses `cafeteria/admin/balances/export/` with no filters, "Toda la escuela").

Per-endpoint table rows: **Search** (`q` fields), **Ordering** (keys, default), **Filters**, **Export** (formats, audit entity), **Bulk** (actions, audit entity), **Import** (columns, `*` = required, match and dedupe rule). "n/a" means the endpoint does not offer it.

## Query budgets

Every admin list and export is pinned by a `django_assert_num_queries` test: the Phase 10 files `backend/apps/*/test_query_budgets*.py` plus the per-phase contract tests (`test_*_contract.py`, `test_data_ops.py`, `test_people_data_ops.py`, `test_portal_history.py`, `test_portal_export.py`). The budget does not grow with the row count or the page size.

- Lists: 2 queries (count + page) unless listed here. Exceptions: Contraseñas 3 (+ `open_count`); ARCO 3 (+ `overdue_count`); Inscripciones 3 (+ documents prefetch); form submissions 3 (+ the form); Depósitos 3 (+ payments prefetch); Clientes Loyverse 5 (+ unmatched-receipt counts, summary per kind, missing count); Medios 5 (+ three reads of referenced ids); guardians sub-list 3; admissions pipeline 3; comunicado delivery report 8 (fixed); family payments history 3 (+ the family's student ids); Reconciliación 2 (the Loyverse read is mocked in the test; in production it is one Loyverse call per row of the page).
- Exports: 3 queries (count + rows + audit insert) unless listed here. Exceptions: Inscripciones 4 (+ documents prefetch); Depósitos 4 (+ payments prefetch); form submissions 4 (+ the form); comunicado delivery 4 (+ the comunicado); per-student cafetería statement 4; family payments export 4 (+ the family's student ids); family ARCO data export 7 (fixed).
- Other pinned reads: bookings availability 1, visits week board 2, family portal dashboard 5, family cafetería balances 4, family monthly statement PDF 3.

## Alumnos

### `GET /accounts/students/`

| | |
| --- | --- |
| Search | `user__first_name`, `user__last_name`, `user__email`, `student_id`, `grade`; a Loyverse spelling (`ci09932`) is searched as `09932` |
| Ordering | `name` (last, first), `student_id`, `grade` (grade, group), `group` (group, grade), `status`, `last_login`, `enrollment_date`, `balance`; default `name` ascending |
| Filters | English key = Spanish alias (the console uses the Spanish one): `status` = `estado` (active, on_leave, graduated, withdrawn); `access` = `acceso` (never, nopass, active); `level` = `nivel` (maternal, preescolar, primaria, secundaria); `grade` = `grado` (exact text); `group` = `grupo` (case-insensitive); `linked` = `vinculado` (1 / 0, Loyverse); `enrolled_from`, `enrolled_to` (dates). Unknown values are ignored, never 400. Filters apply to admins only; families always see just their own children. |
| Extra fields | `balance` (wallet, `0.00` without a wallet) on admin rows |
| Export | `GET /accounts/admin/students/export/` CSV, XLSX, PDF: Alumno, Matrícula, Código Loyverse, Grado, Grupo, Estado, Correo, Tutores, Saldo cafetería, Vinculado a Loyverse, Fecha de ingreso, Último acceso. No medical fields, CURP or emergency contact. Entity `students`. |
| Bulk | `POST /accounts/admin/students/bulk/`, entity `accounts.studentprofile`: `status` (`payload.value` in the four states, transition table; the dry run of `withdrawn` adds `warnings: [{id, name, student_id, balance, message}]` for students with money in the wallet), `grade` (`value` 1 to 20 chars), `group` (`value` 1 to 5 chars, uppercased), `sync_loyverse` (seed the opening balance of linked, never-seeded students; mocked in tests). No delete: `withdrawn` is the archive. |
| Import | `POST /accounts/admin/students/import/`, template `.../import/template/`, entity `students`. Columns `matricula`*, `nombre`*, `apellidos`*, `grado`*, `grupo`, `email_alumno`, `loyverse_id`, `nombre_padre`, `email_padre`, `telefono_padre`. Match: normalised matrícula (either spelling). In-file duplicates by matrícula and by `email_alumno`; guardians matched with `email__iexact`. Unchanged rows are `omitir: Sin cambios.` |

### `GET /accounts/admin/students/<pk>/guardians/`

| | |
| --- | --- |
| Search | name, email, WhatsApp, phone, relationship |
| Ordering | `name`, `email`, `relationship`; default family account first, then last name |
| Filters | n/a; `count` is the total before `q` |
| Export / Bulk / Import | n/a |

## Admisiones

### Pre-registros: `GET /admissions/pre-register/`

| | |
| --- | --- |
| Search | child first/last name, parent name, email, phone |
| Ordering | `created_at`, `child`, `level`, `grade`, `status`, `parent`; default `-created_at` |
| Filters | `status`, `level`, `cycle`, `wants_visit`, `from`, `to` (created_at) |
| Export | `GET /admissions/pre-register/export/` CSV, XLSX, PDF. Entity `pre-registros`. |
| Bulk | `POST /admissions/admin/pre-registrations/bulk/`, entity `admissions.preregistration`: `set_status` (`payload.status`; `payload.note` required for reverse moves), `invite` (pending and contacted only; one email per family) |
| Import | `POST /admissions/admin/pre-registrations/import/`, template `.../import/template/`, entity `pre-registros`. Columns `nombre_alumno`*, `apellidos_alumno`*, `fecha_nacimiento`* (DD/MM/AAAA), `nivel` (derived from `grado` when empty), `grado`*, `nombre_tutor`*, `correo`*, `telefono`, `origen`, `mensaje`. Duplicates (`correo`, names, birth date; case-insensitive; retention placeholders ignored) warn only. Rows are created `pending` in `current_school_cycle()`; no email is sent. |

### Inscripciones: `GET /admissions/register/`

| | |
| --- | --- |
| Search | child first/last name, CURP, parent 1 name, parent 1/2 email, parent 1/2 phone |
| Ordering | `created_at`, `updated_at`, `submitted_at`, `child`, `level`, `status`; default `-created_at` |
| Filters | `status`, `level` (case-insensitive), `cycle`, `documents_pending` (true: a required document is missing or not approved), `from`, `to` |
| Export | `GET /admissions/register/export/` CSV, XLSX, PDF; no medical fields. Entity `inscripciones`. |
| Bulk | `POST /admissions/admin/registrations/bulk/`, entity `admissions.registration`: `approve`, `reject`, `reviewing` (`payload.note`, `payload.notify`), `request_docs` (skips complete files) |
| Import | n/a |

### Documentos: `POST /admissions/admin/documents/bulk/`

| | |
| --- | --- |
| Search / Ordering / Filters / Export / Import | n/a (bulk endpoint only) |
| Bulk | entity `admissions.registrationdocument`: `approve`, `reject` (note required; `payload.notify`, one email per registration) |

### Pipeline: `GET /admissions/admin/pipeline/`

| | |
| --- | --- |
| Search / Ordering / Export / Bulk / Import | n/a |
| Filters | `all=1` lifts the 90-day window on `complete` |

Notes:

- Single-row endpoints share the transition tables with bulk (`apps/core/transitions.py`): `PATCH /admissions/pre-register/<pk>/` and `PATCH /admissions/register/<pk>/status/` accept `note` (required for reverse moves); the latter also takes `notify` and refuses `complete` (reserved for the convert path, `POST /admissions/admin/register/<pk>/convert/`). Every change is audited.
- The frontend ordering constants live in `frontend/src/hooks/queries/admissions.ts` (`PREREG_ORDERING_KEYS`, `REG_ORDERING_KEYS`); `apps/admissions/test_data_ops.py` pins them to the backend whitelists.

## Visitas

### Reservas: `GET /bookings/admin/bookings/`

| | |
| --- | --- |
| Search | parent name, email, phone, child name |
| Ordering | `date` (slot date + start), `status`, `parent`, `child`, `created_at`, `attendees`; default `-date` |
| Filters | `type` (`individual` \| `open_class`), `status`, `source` (`web` \| `whatsapp` \| `admin`), `date` (exact slot date), `from`, `to` (slot date, inclusive), `slot` |
| Export | `GET /bookings/admin/bookings/export/` CSV, XLSX, PDF. Entity `bookings`. |
| Bulk | `POST /bookings/admin/bookings/bulk/`, entity `bookings.booking`: `confirm`, `cancel`, `attended`, `no_show` (`payload.notify` default true; `payload.note` required for the attended ↔ no-show correction) |
| Import | n/a |

### Horarios: `GET /bookings/admin/slots/`

| | |
| --- | --- |
| Search | title, location |
| Ordering | `date` (date + start), `start` (start + date), `type`, `capacity`, `booked` (annotated attendee total); default `-date` |
| Filters | `type`, `active` (`true` \| `false`), `from`, `to` (slot date, inclusive) |
| Export | `GET /bookings/admin/slots/export/` CSV, XLSX, PDF. Entity `bookings.slots`. |
| Bulk | `POST /bookings/admin/slots/bulk/`, entity `bookings.availabilityslot`: `activate`, `deactivate`, `delete` (a slot with any booking, even cancelled, is `skipped` with the reason, never deleted) |
| Import | `POST /bookings/admin/slots/import/`, template `.../import/template/`, entity `bookings.slots`. Columns `tipo`* (individual \| puertas abiertas), `fecha`* (DD/MM/AAAA), `inicio`*, `fin`* (HH:MM), `cupo`* (1 to 1000), `lugar`, `titulo`. Match on the unique tuple (tipo, fecha, inicio, fin): new → `crear` (`get_or_create`), existing with another cupo/lugar/titulo → `actualizar`, identical → `omitir`. Errors (caught in the dry run): past date, `fin` ≤ `inicio`, cupo below the seats already booked, duplicate tuple inside the file. |

Notes:

- Single-row booking moves share the transition table with bulk (`bookings.booking`): `POST /bookings/admin/bookings/<id>/<confirm|cancel|attended|no_show|reopen>/` with body `{note?, notify?}`. pending → confirmed \| cancelled \| no_show \| attended; confirmed → attended \| no_show \| cancelled; cancelled → pending (`reopen`, note required); attended ↔ no_show (note required). A move to pending or confirmed locks the slot (`select_for_update`) and sums `num_attendees` of the other pending/confirmed/attended bookings, the same rule as `create_booking` and `AvailabilitySlot.annotate_booked` (cancelled and no-show free their seats); `.../<id>/reschedule/` uses the same count. Every change is audited (with the note).
- Frontend `/admin/visitas`: `?vista=reservas` (default: `q`, `estado`, `tipo`, `origen`, `desde`, `hasta`, `orden`, `page`) and `?vista=horarios` (`q`, `activo`, `tipo`, `desde`, `hasta`, `orden`, `page`). The ordering constants live in `frontend/src/hooks/queries/bookings.ts` (`BOOKINGS_ORDERING_KEYS`, `SLOTS_ORDERING_KEYS`); `apps/bookings/test_data_ops.py` pins the backend whitelists.

## Cafetería

All under `/cafeteria/admin/` (`backend/apps/cafeteria/admin_data.py`). Matrícula search accepts the Loyverse spelling (`ci09932`) and the stored digits (`09932`).

### Saldos: `GET /cafeteria/admin/balances/`

| | |
| --- | --- |
| Search | student names, matrícula, Código Loyverse, guardian email |
| Ordering | `student`, `grade`, `balance`, `last_synced`, `threshold`; default `student` |
| Filters | `grade`, `group`, `status` (student lifecycle), `low_balance`, `unlinked` |
| Export | `balances/export/` CSV, XLSX, PDF; with no filters it is the whole school ("Toda la escuela"). Entity `cafeteria.balances`. |
| Bulk | `balances/bulk/`, entity `cafeteria.cafeteriabalance`: `sync` (seed + one receipts poll, batched), `set_threshold` (`payload.threshold`, 0 to 100,000) |
| Import | Ajuste masivo, `balances/import/` (template `balances/import/template/`), entity `ajustes_cafeteria`, cap 500 rows. Columns `matricula`* (either spelling), `monto`* (signed: positive credits, negative debits), `motivo`* (up to 500 characters); form fields `notify` (default 1: tell the families) and `mirror` (default 1: best-effort Loyverse points push). Match: the student by matrícula; a student may appear once per file. Errors: unknown matrícula, zero amount, more than $10,000, or a resulting balance below zero. An identical adjustment in the last 24 h is a warning (probable re-upload). Each preview row carries `alumno`, `saldo_actual` and `saldo_resultante`. The commit runs `adjust_balance` per row (savepoint per row, the balance is re-checked under the row lock), so every row leaves a `BalanceAdjustment`, an `ADJUSTMENT` ledger row with a unique `adjust-tx-<uuid>` reference and an audit entry (`import:ajustes_cafeteria`), plus one import summary. |

### Movimientos: `GET /cafeteria/admin/transactions/`

| | |
| --- | --- |
| Search | student names, matrícula, Código Loyverse, description, receipt id |
| Ordering | `date`, `amount`, `type`, `balance`, `student`; default `-date` |
| Filters | `type`, `student`, `from`, `to` |
| Export | `transactions/export/` CSV, XLSX, PDF. Entity `cafeteria.transactions`. |
| Bulk | n/a (selection is for export `?ids=` only); refund stays single-row (`refund/<tx>/`, type-to-confirm in the console) |
| Import | n/a |

### Ajustes: `GET /cafeteria/admin/adjustments/`

| | |
| --- | --- |
| Search | reason |
| Ordering | `date`, `amount`, `kind`; default `-date` |
| Filters | `student`, `kind`, `from`, `to` |
| Export / Bulk / Import | n/a |

### Depósitos: `GET /cafeteria/admin/topups/`

| | |
| --- | --- |
| Search | student names, matrícula, Código Loyverse, `payment_ref` |
| Ordering | `created_at`, `amount`, `status`, `method`, `student`; default `-created_at` |
| Filters | `status`, `method`, `student`, `from`, `to`, `needs_pos`, `needs_unload` |
| Export | `topups/export/` CSV, XLSX, PDF. Entity `cafeteria.topups`. |
| Bulk | `topups/bulk/`, entity `cafeteria.topuprequest`: `apply` (office + pending only; the response carries `total` MXN, also in the dry run), `pos_loaded`, `pos_unloaded` |
| Import | n/a |

### Saldo bajo: `GET /cafeteria/admin/low-balance/`

| | |
| --- | --- |
| Search | as Saldos |
| Ordering | as Saldos; default `balance` ascending |
| Filters | `grade`, `group`, `status` |
| Export | `low-balance/export/` CSV, XLSX, PDF. Entity `cafeteria.low_balance`. |
| Bulk | n/a (selection is for export `?ids=` only) |
| Import | n/a |

### Clientes Loyverse: `GET /cafeteria/admin/customers/`

| | |
| --- | --- |
| Search | name, email, customer code, linked matrícula |
| Ordering | `name`, `code`, `kind`, `points`, `visits`, `spent`, `last_visit`; default `kind, -last_visit, name` |
| Filters | `kind` (`student`, `staff`, `test`, `other`, `nonstudent`), `missing` |
| Extra fields | `summary` (cards per kind + `missing`) in the envelope; 50 per page by default (`page_size` honoured) |
| Export | `customers/export/` CSV, XLSX, PDF. Entity `cafeteria.customers`. |
| Bulk / Import | n/a |

### Reconciliación: `GET /cafeteria/admin/reconcile/`

| | |
| --- | --- |
| Search | student names, matrícula, Código Loyverse |
| Ordering | `student`, `matricula`, `grade`, `local_balance`; default `student` |
| Filters | `grade`, `group`, `only=drift` (within the page) |
| Extra fields | reads Loyverse once per row of the page; `total` is the matching roster (drives the pager), `count` is the rows returned after `only=drift`; `offset` / `limit` / `has_more` describe the page. Paged with `page` / `page_size` only (the `limit` / `offset` query aliases were removed in Phase 10). |
| Export | `reconcile/export/` CSV, XLSX, PDF (one full Loyverse customer fetch). Entity `cafeteria.reconcile`. |
| Bulk | `reconcile/bulk/`, entity `cafeteria.reconcile`: `fix` (max 50 ids, no `all_matching`: each row reads Loyverse live) |
| Import | n/a |

### Per-student statement: `GET /cafeteria/admin/export/student/<pk>/?fmt=csv|pdf`

| | |
| --- | --- |
| Search / Ordering / Filters / Bulk / Import | n/a |
| Export | the student's full ledger as CSV or PDF ("Estado de cuenta" in the student's cafetería console). Audited since Phase 10, entity `cafeteria.student_statement`. |

Notes:

- `student/<pk>/?ledger=0` returns the student console header without the capped ledger lists; the console pages them through `transactions/?student=` and `adjustments/?student=`.
- `GET /cafeteria/admin/export/school/` was removed in Phase 10; "Toda la escuela" is `balances/export/` with no filters.

## Pagos

### `GET /payments/admin/`

| | |
| --- | --- |
| Search | student first/last name, matrícula (`ci09932` accepted), payer email/first/last name, `gateway_tx_id`, `gateway_ref`, description |
| Ordering | `date`, `amount`, `status`, `gateway`, `student` (last, first name); default `-date` |
| Filters | `status`, `gateway`, `type`, `student` (profile id), `from`, `to`. Unknown values are ignored. |
| Export | `GET /payments/admin/export/` CSV, XLSX, PDF. Entity `payments`. |
| Bulk | n/a (selection is for export only; state belongs to the gateway webhook) |
| Import | n/a |
| Frontend | `AdminPayments.tsx`, `hooks/queries/payments.ts` |

## Comunicados

### `GET /portal/admin/announcements/`

| | |
| --- | --- |
| Search | title, body |
| Ordering | `created`, `publish_at`, `title`, `audience`, `reads`, `active`; default `-created` |
| Filters | `audience`, `active` (1/0), `scheduled` (1/0: `publish_at` in the future), `requires_ack` (1/0), `from` / `to` (created) |
| Export | `.../announcements/export/` CSV, XLSX (no PDF). Entity `portal.announcement`. |
| Bulk | `.../announcements/bulk/`, entity `portal.announcement`: `activate` (first activation fans out once), `deactivate` (archive), `delete` (only never fanned out), `duplicate` (inactive draft copy) |
| Import | n/a |

### Delivery report: `GET /portal/admin/announcements/<id>/delivery/export/`

| | |
| --- | --- |
| Search / Filters / Bulk / Import | n/a |
| Ordering | fixed: recipient last name, first name |
| Export | CSV, XLSX: one row per recipient (read, enterado, email/push status, attempts, last error). Entity `portal.announcement.delivery`. |

Guards: a comunicado's activation follows the `portal.announcement` transition table (draft/inactive ↔ active) on both the single PATCH and bulk; a comunicado already sent to families (`fanout_at`) cannot be deleted, single or bulk (deactivate archives it). Audit context `portal.announcement`.

## Mensajes

### `GET /core/admin/contact-messages/`

| | |
| --- | --- |
| Search | name, email, subject, message |
| Ordering | `date`, `name`, `email`, `subject`, `handled`; default `-date` |
| Filters | `handled` (`1` / `0`), `from`, `to` |
| Export | `/core/admin/contact-messages/export/` CSV, XLSX, PDF. Entity `contact_messages`. |
| Bulk | `/core/admin/contact-messages/bulk/`, entity `core.contactmessage`: `mark_handled`, `reopen` (rows already in that state are skipped) |
| Import | n/a |
| Frontend | `AdminContactInbox.tsx`, `hooks/queries/contactMessages.ts` |

Single row: `PATCH /core/admin/contact-messages/<id>/ {"is_handled": bool}`, audited (`context='contact.handled'`) when the value changes.

## Solicitudes de contraseña

### `GET /accounts/admin/password-requests/`

| | |
| --- | --- |
| Search | `requested_email`, `requester_name`, `user__email`, `user__first_name`, `user__last_name` |
| Ordering | `created_at`, `status`, `requested_email`, `channel`, `resolved_at`; default `-created_at` |
| Filters | `status` = `estado`; `channel` = `canal`; `linked` 1 / 0; `from` = `desde`, `to` = `hasta` (created_at, aware bounds). The page opens on `open` when `estado` is absent; `estado=todas` lifts it. |
| Extra fields | `open_count` on the page (the Pendientes badge) |
| Export | `GET .../password-requests/export/` CSV, XLSX, PDF (GET only). Entity `password_requests`. |
| Bulk | `POST .../password-requests/bulk/`, entity `accounts.passwordrequest`: `reject` (`payload.note` required, stored in the note and the audit). `resolve` stays single-row (it generates a password shown once). The single-row reject is audited too. |
| Import | n/a |

## Contenido

Admin only unless a table says "admin or staff". Audit contexts: `cms.page`, `cms.publish` / `cms.unpublish`, `cms.media`, `cms.form`, `cms.form-submission`, `cms.redirect`, `cms.testimonial`, `cms.calendar`.

### Páginas: `GET /content/admin/pages/` (admin or staff)

| | |
| --- | --- |
| Search | title, slug |
| Ordering | `title`, `slug`, `status`, `template`, `updated`, `published`, `created`; default `slug` |
| Filters | `status`, `template`, `review` (1/0: approval requested) |
| Export | `.../pages/export/` CSV, XLSX, PDF (admin). Entity `content.page`. |
| Bulk | `.../pages/bulk/` (admin), entity `content.page`: `publish` (pre-publish checks per row; errors fail the row), `unpublish`, `delete` (drafts never published only) |
| Import | n/a |

### Formularios: `GET /content/admin/forms/`

| | |
| --- | --- |
| Search | title, slug |
| Ordering | `title`, `slug`, `updated`, `submissions`, `pending`, `published`; default `title` |
| Filters | `published` (1/0) |
| Export | `.../forms/export/` CSV, XLSX, PDF. Entity `content.formdefinition`. |
| Bulk | `.../forms/bulk/`, entity `content.formdefinition`: `delete` (forms without submissions only) |
| Import | n/a |

### Envíos: `GET /content/admin/forms/<id>/submissions/` (or `?form=<id>`)

| | |
| --- | --- |
| Search | every answer (`search_text`) |
| Ordering | `date`, `handled`, `page`; default `-date` |
| Filters | `handled` (1/0), `from`, `to` |
| Export | `.../forms/<id>/submissions/export/` CSV, XLSX, PDF (the console offers CSV and Excel), one column per form field (replaces `?export=csv`). Entity `content.formsubmission`. |
| Bulk | `POST /content/admin/form-submissions/bulk/`, entity `content.formsubmission`: `mark_handled`, `reopen`, `delete` (`all_matching` filters carry `form`) |
| Import | n/a |

### Redirecciones: `GET /content/admin/redirects/`

| | |
| --- | --- |
| Search | from_path, to_path |
| Ordering | `from`, `to`, `permanent`, `hits`, `created`; default `from` |
| Filters | `permanent` (1/0) |
| Export | `.../redirects/export/` CSV, XLSX, PDF (headers `de`, `a`, `permanente` match the import). Entity `content.redirect`. |
| Bulk | `.../redirects/bulk/`, entity `content.redirect`: `delete` |
| Import | `.../redirects/import/`, template `.../import/template/`, entity `content.redirect`. Columns `de`, `a`, `permanente`. Dedupe on `de` (file and DB: an existing path is updated, an identical one is omitted); a reserved path (for example `/api/...`) is an error. |

### Medios: `GET /content/admin/media/` (admin or staff)

| | |
| --- | --- |
| Search | filename, alt, caption, tags |
| Ordering | `created`, `filename`, `size`, `type`, `alt`; default `-created` |
| Filters | `type` (jpeg, png, webp, gif), `unreferenced` (1/0), `missing_alt` (1/0), `from`, `to` |
| Export | `.../media/export/` CSV, XLSX, PDF. Entity `content.mediaasset`. |
| Bulk | `.../media/bulk/` (admin or staff), entity `content.mediaasset`: `delete` (unreferenced only), `add_tag` (`payload.tag`) |
| Import | n/a as a spreadsheet; upload is `POST` one file per request; the same sha256 answers 409 `{detail, existing}` |

### Calendario: `GET /content/admin/calendar/`

| | |
| --- | --- |
| Search | title, description |
| Ordering | `start`, `end`, `title`, `kind`, `level`, `published`, `updated`; default `start, title` |
| Filters | `kind`, `level` (`todos` = all levels), `published` (1/0), `from`, `to` (events overlapping the range) |
| Export | `.../calendar/export/` CSV, XLSX, PDF. Entity `content.schoolevent`. |
| Bulk | `.../calendar/bulk/`, entity `content.schoolevent`: `publish`, `unpublish`, `delete` |
| Import | `.../calendar/import/`, template `.../import/template/`, entity `content.schoolevent`. Columns `titulo`, `tipo`, `inicio`, `fin` (DD/MM/AAAA), `nivel`, `descripcion`, `publicado`. Dedupe in the file on (`titulo`, `inicio`); DB match by title (case-insensitive) + start date → `actualizar`. |

Public: `GET /content/calendar.ics` (published events from one year back, all-day VEVENTs, RFC 5545 folding, cached 10 minutes, cleared on every calendar write; see `docs/OPS-RUNBOOK.md` section 8).

### Testimonios: `GET /content/admin/testimonials/`

| | |
| --- | --- |
| Search | quote, author, role |
| Ordering | `order`, `author`, `level`, `published`, `created`; default `order, -created` |
| Filters | `published` (1/0), `level` (`general` = empty) |
| Export | `.../testimonials/export/` CSV, XLSX, PDF. Entity `content.testimonial`. |
| Bulk | `.../testimonials/bulk/`, entity `content.testimonial`: `publish`, `unpublish`, `delete` |
| Import | n/a |

## Usuarios del personal

### `GET /accounts/admin/staff/`

| | |
| --- | --- |
| Search | `email`, `first_name`, `last_name` |
| Ordering | `name`, `email`, `role`, `is_active`, `last_login`, `date_joined`; default active first, then role, then name |
| Filters | `role` = `rol` (admin, staff); `active` = `activo` (1 / 0) |
| Export | `GET .../admin/staff/export/` CSV, XLSX, PDF (GET only): Nombre, Correo, Rol, Activo, Superusuario, Contraseña asignada, Último acceso, Alta. Entity `staff`. |
| Bulk | `POST .../admin/staff/bulk/`, entity `accounts.user`: `deactivate` (revokes refresh tokens), `reactivate`. Per row: superusers and non-staff accounts skipped, own account skipped, the last active admin fails. No delete. |
| Import | Invite: `POST .../admin/staff/import/`, template `.../import/template/`, entity `staff`. Columns `correo`*, `nombre`*, `apellidos`, `rol` (staff / admin, labels accepted). Match on `correo`: creates accounts without a usable password; an existing staff account is `omitir`; an address that belongs to a family, student or superuser is an error. |

## Auditoría

### `GET /core/admin/audit/`

| | |
| --- | --- |
| Search | `actor_label`, `context`, `object_id` |
| Ordering | `date`, `action`, `actor` (actor email), `object` (type, id), `context`; default `-date` |
| Filters | `action`, `actor` (label or email contains), `object_type` (exact), `object_id` (exact), `context` (contains), `from`, `to` |
| Export | `/core/admin/audit/export/` CSV, XLSX, PDF. Entity `audit`. |
| Bulk | n/a (append-only) |
| Import | n/a |
| Frontend | `AdminAudit.tsx`, `hooks/queries/audit.ts` |

## ARCO

### `GET /legal/admin/arco/`

| | |
| --- | --- |
| Search | requester email, requester name, details |
| Ordering | `date`, `deadline` (statutory deadline), `status`, `type`, `requester`; default `-date` |
| Filters | `status` (a status, a comma list, or `open` = received + in review), `type`, `channel`, `overdue` (`1` / `0`), `from`, `to` |
| Extra fields | `overdue_count` over the whole filtered set (not just the page) |
| Export | `/legal/admin/arco/export/` CSV, XLSX, PDF. Entity `arco`. |
| Bulk | `/legal/admin/arco/bulk/`, entity `legal.arcorequest`: `in_review` (from `received` only) |
| Import | n/a |
| Frontend | `AdminArco.tsx`, `hooks/queries/arco.ts` |

Single row: `POST /legal/admin/arco/<id>/status/ {"status", "resolution_note"}`, guarded by the `legal.arcorequest` transition table; `resolved` and `rejected` require `resolution_note` (emailed to the requester); reopening a closed request (`resolved|rejected → in_review`) requires a note and clears `resolved_at`; audited with the note (`context='legal.arco.status'`).

Frontend URL vocabulary on the Pagos, Mensajes, Auditoría and ARCO pages: `q`, `orden` → `ordering`, `page`, `estado` → `status` / `handled`, `pasarela` → `gateway`, `alumno` → `student`, `tipo` → `type`, `vencidas` → `overdue`, `accion` → `action`, `actor`, `contexto` → `context`, `objeto` → `object_type`, `id` → `object_id`, `desde` / `hasta` → `from` / `to`.

## Portal de familias

Family-scoped lists (`IsAuthenticated`): a parent sees only their linked children, a student login only their own profile, an admin everything; another family's `student` id yields an empty list or file, never their rows. Staff are refused on the cafetería export. No search, no bulk actions and no imports in the portal. Each export subclasses its list view, so scoping, filters and ordering are the same code; see the shared contract for formats, cap, throttle and audit.

### Cafetería: `GET /cafeteria/transactions/`

| | |
| --- | --- |
| Search / Bulk / Import | n/a |
| Ordering | `date`, `amount`, `type`, `balance`; default `-date` |
| Filters | `student` (profile id), `type` (`purchase`, `topup`, `refund`), `from`, `to` |
| Export | `GET /cafeteria/export/?fmt=csv\|xlsx` + the same params. Columns Alumno, Matrícula, Fecha, Tipo, Descripción, Monto, Saldo. Entity `cafeteria.family_transactions`. |
| Frontend | `pages/parent/CafeteriaPage.tsx` |

### Pagos: `GET /payments/history/`

| | |
| --- | --- |
| Search / Bulk / Import | n/a |
| Ordering | `date`, `amount`, `status`, `gateway`; default `-date` (the portal offers `date`, `amount`, `status`) |
| Filters | `status`, `student` (profile id), `from`, `to` |
| Export | `GET /payments/history/export/?fmt=csv\|xlsx` + the same params. Columns Fecha, Alumno, Concepto, Monto, Moneda, Estado, Pasarela, Referencia. Entity `payments.family`. |
| Frontend | `pages/parent/PaymentsPage.tsx` |

### Comunicados: `GET /portal/announcements/`

| | |
| --- | --- |
| Search / Export / Bulk / Import | n/a |
| Ordering | fixed (newest first) |
| Filters | none (audience-scoped server-side) |
| Frontend | `pages/parent/ComunicadosPage.tsx` |

### Notificaciones: `GET /portal/notifications/`

| | |
| --- | --- |
| Search / Export / Bulk / Import | n/a |
| Ordering | fixed (`-created_at`) |
| Filters | `type` (`info`, `warning`, `payment`, `cafeteria`), `unread=1` |
| Frontend | `pages/parent/NotificationsPage.tsx` |

### Inscripciones: `GET /admissions/my-registrations/`

| | |
| --- | --- |
| Search / Export / Bulk / Import | n/a |
| Ordering | fixed |
| Filters | none server-side (a family has a handful; `?estado=` filters in the page) |
| Frontend | `pages/parent/InscripcionesPage.tsx` |

### Documents

- Monthly cafetería statement: `GET /cafeteria/statement/?student=&month=YYYY-MM` (PDF).
- Payment comprobante: `GET /payments/<id>/receipt/` (PDF).
- ARCO data export (derecho de Acceso): `GET /legal/arco/export/`, JSON with everything held on the requesting household (account, children including their medical data, consents, payments, bookings, ARCO requests, cafetería balances and ledger); internal secrets excluded. "Descargar mis datos" on `pages/parent/PrivacyPage.tsx`. Not part of the export framework (no row cap, no `export:` audit row).

Frontend URL vocabulary on these pages: `orden` → `ordering`, `page`, `alumno` → `student`, `tipo` → `type`, `estado` → `status`, `desde` / `hasta` → `from` / `to`, `sin_leer` → `unread`. On Cafetería, `?alumno=` is kept in step with the portal child switcher (the last one changed wins). A bookmarked `?page=` past the end (DRF 404) falls back to page 1.
