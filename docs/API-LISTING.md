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
