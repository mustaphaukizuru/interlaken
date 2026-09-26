# Admin list endpoints: search, ordering, filters, export, bulk, import

One row per admin list on the Data Ops contracts (`docs/DATA-OPS-PROMPT.md`, C1 to C5). Every list accepts `q`, `ordering` (whitelist, `-pk` tiebreak), `page` and `page_size` (up to 100). Each phase appends its section.

## Admisiones (Data Ops Phase 4)

| Endpoint | `q` searches | `ordering` keys | Filters | Export | Bulk actions | Import |
|---|---|---|---|---|---|---|
| `GET /api/v1/admissions/pre-register/` | child first/last name, parent name, email, phone (`search` alias for one release) | `created_at`, `child`, `level`, `grade`, `status`, `parent` (default `-created_at`) | `status`, `level`, `cycle`, `wants_visit`, `from`, `to` (created_at, America/Mexico_City days) | `GET .../pre-register/export/?fmt=csv\|xlsx\|pdf&ids=` | `POST /api/v1/admissions/admin/pre-registrations/bulk/`: `set_status` (`payload.status`, `payload.note` for reverse moves), `invite` | `GET .../admin/pre-registrations/import/template/`, `POST .../admin/pre-registrations/import/` |
| `GET /api/v1/admissions/register/` | child first/last name, CURP, parent 1 name, parent 1/2 email, parent 1/2 phone | `created_at`, `updated_at`, `submitted_at`, `child`, `level`, `status` (default `-created_at`) | `status`, `level` (case-insensitive), `cycle`, `documents_pending` (true: a required document is missing or not approved), `from`, `to` | `GET .../register/export/?fmt=csv\|xlsx\|pdf&ids=` (no medical fields) | `POST /api/v1/admissions/admin/registrations/bulk/`: `approve`, `reject`, `reviewing` (`payload.note`, `payload.notify`), `request_docs` | none |
| `POST /api/v1/admissions/admin/documents/bulk/` | n/a | n/a | n/a | n/a | `approve`, `reject` (note required; `payload.notify`, one email per registration) | none |
| `GET /api/v1/admissions/admin/pipeline/` | n/a | n/a | `all=1` lifts the 90-day window on `complete` | n/a | n/a | n/a |

Single-row endpoints share the transition tables with bulk (`apps/core/transitions.py`): `PATCH /admissions/pre-register/<pk>/` and `PATCH /admissions/register/<pk>/status/` accept `note` (required for reverse moves); the latter also takes `notify` and refuses `complete` (reserved for the convert path). Every change is audited.

Pre-registros import columns: `nombre_alumno`*, `apellidos_alumno`*, `fecha_nacimiento`* (DD/MM/AAAA), `nivel` (derived from `grado` when empty), `grado`*, `nombre_tutor`*, `correo`*, `telefono`, `origen`, `mensaje`. Duplicates (`correo`, names, birth date; case-insensitive; retention placeholders ignored) warn only. Rows are created `pending` in `current_school_cycle()` and no email is sent.

The frontend ordering constants live in `frontend/src/hooks/queries/admissions.ts` (`PREREG_ORDERING_KEYS`, `REG_ORDERING_KEYS`); `apps/admissions/test_data_ops.py` pins them to the backend whitelists.

## Visitas (Data Ops Phase 5)

| Endpoint | `q` searches | `ordering` keys | Filters | Export | Bulk actions | Import |
|---|---|---|---|---|---|---|
| `GET /api/v1/bookings/admin/bookings/` | parent name, email, phone, child name | `date` (slot date + start), `status`, `parent`, `child`, `created_at`, `attendees` (default `-date`) | `type` (`individual` \| `open_class`), `status`, `source` (`web` \| `whatsapp` \| `admin`), `date` (exact slot date), `from`, `to` (slot date, inclusive), `slot` | `GET .../admin/bookings/export/?fmt=csv\|xlsx\|pdf&ids=` (audit `export:bookings`) | `POST .../admin/bookings/bulk/`: `confirm`, `cancel`, `attended`, `no_show` (`payload.notify` default true; `payload.note` required for the attended ↔ no-show correction) | none |
| `GET /api/v1/bookings/admin/slots/` | title, location | `date` (date + start), `start` (start + date), `type`, `capacity`, `booked` (annotated attendee total) (default `-date`) | `type`, `active` (`true` \| `false`), `from`, `to` (slot date, inclusive) | `GET .../admin/slots/export/?fmt=csv\|xlsx\|pdf&ids=` (audit `export:bookings.slots`) | `POST .../admin/slots/bulk/`: `activate`, `deactivate`, `delete` (a slot with any booking, even cancelled, is `skipped` with the reason, never deleted) | `GET .../admin/slots/import/template/`, `POST .../admin/slots/import/` |

Single-row booking moves share the transition table with bulk (`apps/core/transitions.py`, `bookings.booking`): `POST /api/v1/bookings/admin/bookings/<id>/<confirm|cancel|attended|no_show|reopen>/` with body `{note?, notify?}`. pending → confirmed \| cancelled \| no_show \| attended; confirmed → attended \| no_show \| cancelled; cancelled → pending (`reopen`, note required); attended ↔ no_show (note required). A move to pending or confirmed locks the slot (`select_for_update`) and sums `num_attendees` of the other pending/confirmed/attended bookings, the same rule as `create_booking` and `AvailabilitySlot.annotate_booked` (cancelled and no-show free their seats); `.../<id>/reschedule/` uses the same count. Every change is audited (with the note).

Horarios import columns: `tipo`* (individual \| puertas abiertas), `fecha`* (DD/MM/AAAA), `inicio`*, `fin`* (HH:MM), `cupo`* (1 to 1000), `lugar`, `titulo`. Matched on the unique tuple (tipo, fecha, inicio, fin): new → `crear` (`get_or_create`), existing with another cupo/lugar/titulo → `actualizar`, identical → `omitir`. Errors (caught in the dry run): past date, `fin` ≤ `inicio`, cupo below the seats already booked, duplicate tuple inside the file.

Frontend `/admin/visitas`: `?vista=reservas` (default: `q`, `estado`, `tipo`, `origen`, `desde`, `hasta`, `orden`, `page`) and `?vista=horarios` (`q`, `activo`, `tipo`, `desde`, `hasta`, `orden`, `page`). The ordering constants live in `frontend/src/hooks/queries/bookings.ts` (`BOOKINGS_ORDERING_KEYS`, `SLOTS_ORDERING_KEYS`); `apps/bookings/test_data_ops.py` pins the backend whitelists. Both lists are 2 queries (count + page) whatever the page size.

## Phase 3: Alumnos, Usuarios, Contraseñas

### Alumnos: `GET /api/v1/accounts/students/`

| | |
| --- | --- |
| Search (`q`, legacy alias `search`) | `user__first_name`, `user__last_name`, `user__email`, `student_id`, `grade`; a Loyverse spelling (`ci09932`) is searched as `09932` |
| Ordering keys | `name` (last, first), `student_id`, `grade` (grade, group), `group` (group, grade), `status`, `last_login`, `enrollment_date`, `balance`; default `name` ascending |
| Filters (English = Spanish alias; URL param in brackets) | `status`=`estado` [`estado`] active, on_leave, graduated, withdrawn; `access`=`acceso` [`acceso`] never, nopass, active; `level`=`nivel` [`nivel`] maternal, preescolar, primaria, secundaria; `grade`=`grado` [`grado`] exact text; `group`=`grupo` [`grupo`] case-insensitive; `linked`=`vinculado` [`vinculado`] 1 / 0 (Loyverse); `enrolled_from`, `enrolled_to` (dates). Unknown values are ignored, never 400. Filters apply to admins only; families always see just their own children. |
| Extra field | `balance` (wallet, `0.00` without a wallet) on admin rows |
| Query budget | 2 (count + page), any page size, any ordering including `balance` |
| Export | `GET /api/v1/accounts/admin/students/export/` CSV/XLSX/PDF: Alumno, Matrícula, Código Loyverse, Grado, Grupo, Estado, Correo, Tutores, Saldo cafetería, Vinculado a Loyverse, Fecha de ingreso, Último acceso. No medical fields, CURP or emergency contact. Entity `students`. |
| Bulk | `POST /api/v1/accounts/admin/students/bulk/`, entity `accounts.studentprofile`: `status` (`payload.value` in the four states, transition table; the dry run of `withdrawn` adds `warnings: [{id, name, student_id, balance, message}]` for students with money in the wallet), `grade` (`value` 1 to 20 chars), `group` (`value` 1 to 5 chars, uppercased), `sync_loyverse` (seed the opening balance of linked, never-seeded students; mocked in tests). No delete: `withdrawn` is the archive. |
| Import | `POST /api/v1/accounts/admin/students/import/`, template `.../import/template/`. Columns: `matricula`*, `nombre`*, `apellidos`*, `grado`*, `grupo`, `email_alumno`, `loyverse_id`, `nombre_padre`, `email_padre`, `telefono_padre` (* required; accents, case and spaces in headers do not matter). Key: normalised matrícula; in-file duplicates by matrícula and by `email_alumno`; guardians matched with `email__iexact`. Unchanged rows are `omitir: Sin cambios.` Entity `students`. |

Guardians sub-list `GET /api/v1/accounts/admin/students/<pk>/guardians/`: `?q=` over name, email, WhatsApp, phone and relationship; `?ordering=[-]name|email|relationship` (default: family account first, then last name); `count` is the total before `q`.

### Usuarios del personal: `GET /api/v1/accounts/admin/staff/`

| | |
| --- | --- |
| Search | `email`, `first_name`, `last_name` |
| Ordering keys | `name`, `email`, `role`, `is_active`, `last_login`, `date_joined`; default active first, then role, then name |
| Filters | `role`=`rol` [`rol`] admin, staff; `active`=`activo` [`activo`] 1 / 0 |
| Query budget | 2 |
| Export | `GET .../admin/staff/export/` (GET only): Nombre, Correo, Rol, Activo, Superusuario, Contraseña asignada, Último acceso, Alta. Entity `staff`. |
| Bulk | `POST .../admin/staff/bulk/`, entity `accounts.user`: `deactivate` (revokes refresh tokens), `reactivate`. Per row: superusers and non-staff accounts skipped, own account skipped, the last active admin fails. No delete. |
| Import (invite) | `POST .../admin/staff/import/`, template `.../import/template/`: `correo`*, `nombre`*, `apellidos`, `rol` (staff / admin, labels accepted). Creates accounts without a usable password; an existing staff account is `omitir`; an address that belongs to a family, student or superuser is an error. Entity `staff`. |

### Solicitudes de contraseña: `GET /api/v1/accounts/admin/password-requests/`

| | |
| --- | --- |
| Search | `requested_email`, `requester_name`, `user__email`, `user__first_name`, `user__last_name` |
| Ordering keys | `created_at` (default, newest first), `status`, `requested_email`, `channel`, `resolved_at` |
| Filters | `status`=`estado`; `channel`=`canal` [`canal`]; `linked` 1 / 0; `from`, `to` (created_at, aware bounds) [`desde`, `hasta`]. The page opens on `open` when `estado` is absent; `estado=todas` lifts it. |
| Extra field | `open_count` on the page (the Pendientes badge) |
| Query budget | 3 (count + page + open_count) |
| Export | `GET .../admin/password-requests/export/` (GET only). Entity `password_requests`. |
| Bulk | `POST .../admin/password-requests/bulk/`, entity `accounts.passwordrequest`: `reject` (`payload.note` required, stored in the note and the audit). `resolve` stays single-row (it generates a password shown once). The single-row reject is audited too. |

## Cafetería (Phase 6, `backend/apps/cafeteria/admin_data.py`)

All under `/api/v1/cafeteria/admin/`, `IsAdmin`. Matrícula search accepts the Loyverse spelling (`ci09932`) and the stored digits (`09932`).

| Endpoint | `q` searches | `ordering` keys (default) | Filters | Export | Bulk actions | Import |
| --- | --- | --- | --- | --- | --- | --- |
| `balances/` | student names, matrícula, Código Loyverse, guardian email | `student`, `grade`, `balance`, `last_synced`, `threshold` (student) | `grade`, `group`, `status` (student lifecycle), `low_balance`, `unlinked` | `balances/export/` CSV/XLSX/PDF; no filters = whole school | `balances/bulk/`: `sync` (seed + one receipts poll, batched), `set_threshold` (`payload.threshold`, 0 to 100,000) | `balances/import/`: ajuste masivo `matricula, monto, motivo` (see below) |
| `transactions/` | student names, matrícula, Código Loyverse, description, receipt id | `date`, `amount`, `type`, `balance`, `student` (-date) | `type`, `student`, `from`, `to` | `transactions/export/` | export only (`?ids=`); refund stays single-row (`refund/<tx>/`) | n/a |
| `adjustments/` | reason | `date`, `amount`, `kind` (-date) | `student`, `kind`, `from`, `to` | n/a | n/a | n/a |
| `topups/` | student names, matrícula, Código Loyverse, `payment_ref` | `created_at`, `amount`, `status`, `method`, `student` (-created_at) | `status`, `method`, `student`, `from`, `to`, `needs_pos`, `needs_unload` | `topups/export/` | `topups/bulk/`: `apply` (office + pending only; response carries `total` MXN, also in the dry run), `pos_loaded`, `pos_unloaded` | n/a |
| `low-balance/` | as `balances/` | as `balances/` (balance ascending) | `grade`, `group`, `status` | `low-balance/export/` | export only | n/a |
| `customers/` | name, email, customer code, linked matrícula | `name`, `code`, `kind`, `points`, `visits`, `spent`, `last_visit` (kind, -last_visit, name) | `kind` (`student`, `staff`, `test`, `other`, `nonstudent`), `missing` | `customers/export/` | n/a | n/a |
| `reconcile/` | student names, matrícula, Código Loyverse | `student`, `matricula`, `grade`, `local_balance` (student) | `grade`, `group`, `only=drift` (within the page) | `reconcile/export/` (one full Loyverse customer fetch) | `reconcile/bulk/`: `fix` (max 50 ids, no `all_matching`: each row reads Loyverse live) | n/a |

Notes:

- `customers/` adds `summary` (cards per kind + `missing`) to the envelope and defaults to 50 per page (`page_size` honoured).
- `reconcile/` reads Loyverse once per row of the page. `total` is the matching roster (drives the pager); `count` is the rows returned after `only=drift`. Legacy `limit`/`offset` still work for one release.
- `student/<pk>/?ledger=0` returns the student console header without the capped ledger lists; the console pages them through `transactions/?student=` and `adjustments/?student=`.
- The old `export/school/` endpoint stays for one release; the console uses `balances/export/` with no filters ("Toda la escuela").

### Ajuste masivo (`balances/import/`)

Columns `matricula` (either spelling), `monto` (signed: positive credits, negative debits), `motivo` (up to 500 characters). Form fields `notify` (default 1: tell the families) and `mirror` (default 1: best-effort Loyverse points push). Cap 500 rows.

The dry run is the commit's own check: unknown matrícula, zero amount, more than $10,000, or a resulting balance below zero is an error row; a student may appear once per file; an identical adjustment in the last 24 h is a warning (probable re-upload). Each row's preview carries `alumno`, `saldo_actual` and `saldo_resultante`. The commit runs `adjust_balance` per row (savepoint per row, the balance is re-checked under the row lock), so every row leaves a `BalanceAdjustment`, an `ADJUSTMENT` ledger row with a unique `adjust-tx-<uuid>` reference and an audit entry (`import:ajustes_cafeteria`), plus one import summary.

## Phase 7: Pagos, Auditoría, Mensajes, ARCO

| Endpoint | `q` searches | Ordering keys (default) | Filters | Export | Bulk | Frontend |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/v1/payments/admin/` | student first/last name, matrícula (`ci09932` accepted), payer email/first/last name, `gateway_tx_id`, `gateway_ref`, description | `date`, `amount`, `status`, `gateway`, `student` (last, first name) (`-date`) | `status`, `gateway`, `type`, `student` (profile id), `from`, `to` | `/payments/admin/export/` CSV, XLSX, PDF; entity `payments` | export only (state belongs to the gateway webhook) | `AdminPayments.tsx`, `hooks/queries/payments.ts` |
| `GET /api/v1/core/admin/audit/` | `actor_label`, `context`, `object_id` | `date`, `action`, `actor` (actor email), `object` (type, id), `context` (`-date`) | `action`, `actor` (label or email contains), `object_type` (exact), `object_id` (exact), `context` (contains), `from`, `to` | `/core/admin/audit/export/` CSV, XLSX, PDF; entity `audit` | n/a (append-only) | `AdminAudit.tsx`, `hooks/queries/audit.ts` |
| `GET /api/v1/core/admin/contact-messages/` | name, email, subject, message | `date`, `name`, `email`, `subject`, `handled` (`-date`) | `handled` (`1`/`0`), `from`, `to` | `/core/admin/contact-messages/export/` CSV, XLSX, PDF; entity `contact_messages` | `/core/admin/contact-messages/bulk/`: `mark_handled`, `reopen` (rows already in that state are skipped) | `AdminContactInbox.tsx`, `hooks/queries/contactMessages.ts` |
| `GET /api/v1/legal/admin/arco/` | requester email, requester name, details | `date`, `deadline` (statutory deadline), `status`, `type`, `requester` (`-date`) | `status` (a status, a comma list, or `open` = received + in review), `type`, `channel`, `overdue` (`1`/`0`), `from`, `to`; the response adds `overdue_count` over the whole filtered set | `/legal/admin/arco/export/` CSV, XLSX, PDF; entity `arco` | `/legal/admin/arco/bulk/`: `in_review` (from `received` only) | `AdminArco.tsx`, `hooks/queries/arco.ts` |

Frontend URL vocabulary on these pages: `q`, `orden` → `ordering`, `page`, `estado` → `status` / `handled`, `pasarela` → `gateway`, `alumno` → `student`, `tipo` → `type`, `vencidas` → `overdue`, `accion` → `action`, `actor`, `contexto` → `context`, `objeto` → `object_type`, `id` → `object_id`, `desde` / `hasta` → `from` / `to`.

### Single-row workflow endpoints

- `PATCH /api/v1/core/admin/contact-messages/<id>/ {"is_handled": bool}`: audited (`context='contact.handled'`) when the value changes.
- `POST /api/v1/legal/admin/arco/<id>/status/ {"status", "resolution_note"}`: guarded by the `legal.arcorequest` transition table (`apps/core/transitions.py`); `resolved` and `rejected` require `resolution_note` (emailed to the requester); reopening a closed request (`resolved|rejected → in_review`) requires a note and clears `resolved_at`; audited with the note (`context='legal.arco.status'`).
