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
