# Admin list endpoints: search, ordering, filters, export, bulk, import

The Data Operations round (`docs/DATA-OPS-PROMPT.md`, contracts C1 to C5) gives every admin list the same shape. This file is the table the frontend and the backend agree on; each phase adds its rows. The shared rules:

- **List** (`apps/core/listing.py AdminListMixin`): `?q=` search (terms AND-ed, each term ORs the search fields; accent-insensitive on Postgres), `?ordering=[-]<key>` from the whitelist below (anything else falls back to the default; a `-pk` tiebreak is always appended), `?page=` and `?page_size=` (max 100), entity filters through a django-filter FilterSet. Response `{count, next, previous, results}`.
- **Export** (`apps/core/exporting.py AdminExportMixin`): `GET .../export/?fmt=csv|xlsx|pdf` with the same `q`, filters and `ordering` as the list, plus `?ids=1,2,3` (max 500) for "export selected". Caps: 10,000 rows (CSV/XLSX), 1,000 (PDF), 413 above. Throttle `admin-export` 30/min. Audited as `export:<entity>`.
- **Bulk** (`apps/core/bulk.py AdminBulkView`): `POST .../bulk/` `{action, ids (≤500) | all_matching + filters (≤2,000), payload, dry_run}` → `{action, requested, ok, failed, skipped, dry_run}` (plus `warnings` where noted). Throttle `admin-bulk` 30/min. One audit row per changed row plus one `bulk:<entity>` summary.
- **Import** (`apps/core/importing.py ImportView`): `GET .../import/template/?fmt=csv|xlsx`; `POST .../import/` multipart `file`, `dry_run=1` (default) or `0`, `report=csv|xlsx` (annotated file), `valid_only=1`. Caps 2,000 rows / 5 MB (413). Throttle `admin-import` 10/min. Audited per row (`import:<entity>`) plus one summary.

Frontend URL params map to the API as `q`→`q`, `orden`→`ordering`, `page`→`page`, `estado`→`status`, plus the per-page names listed below.

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
