# API listing contract: endpoints, keys, filters, exports

One table per admin list of the Data Operations round (`docs/DATA-OPS-PROMPT.md`, contracts C1 to C5). Each phase appends its section; keep the ordering keys identical to the frontend `sortKey` values (a backend test pins each whitelist).

Shared rules (all lists on `apps.core.listing.AdminListMixin`):

- `q`: search, terms AND-ed, each term OR-ed over the search fields (`unaccent` + `icontains` on Postgres, `icontains` on SQLite).
- `ordering`: `[-]<key>` from the whitelist; unknown keys fall back to the default; a `-pk` tiebreak is always appended.
- `page`, `page_size` (≤ 100). Response `{count, next, previous, results}`.
- Export sibling `GET .../export/?fmt=csv|xlsx|pdf&ids=1,2,3` takes the same params as the list. Caps: 10,000 rows (CSV/XLSX), 1,000 (PDF), 500 `ids`; above a cap → 413 `{"detail": "Acote los filtros: el límite es N filas."}`. Audited as `export:<entity>`. Throttle `admin-export` 30/min.
- Bulk `POST .../bulk/` `{action, ids ≤ 500 | all_matching + filters (≤ 2,000), payload, dry_run}` → `{action, requested, ok, failed[], skipped[], dry_run}`. Per-row audit + one `bulk:<entity>` summary. Throttle `admin-bulk` 30/min.
- Import `GET .../import/template/?fmt=csv|xlsx`, `POST .../import/` multipart `file`, `dry_run=1` (default) | `0`, `report=csv|xlsx`, `valid_only=1`. Caps 2,000 rows / 5 MB. Audited per row (`import:<entity>` context) + one summary. Throttle `admin-import` 10/min.

URL vocabulary (frontend → API): `q`→`q`, `orden`→`ordering`, `page`→`page`, `estado`→`status`, `tipo`→`type`, `desde`/`hasta`→`from`/`to`.

## Visitas (Phase 5, `apps/bookings`)

### Reservas: `GET /api/v1/bookings/admin/bookings/`

| | |
|---|---|
| View | `AdminBookingsView` (`apps/bookings/views.py`), specs in `apps/bookings/data_ops.py` |
| Search (`q`) | `parent_name`, `parent_email`, `parent_phone`, `child_name` |
| Ordering keys | `date` (slot date + start), `status`, `parent`, `child`, `created_at`, `attendees` (`num_attendees`); default `-date` |
| Filters | `type` (`individual` \| `open_class`), `status` (`pending` \| `confirmed` \| `cancelled` \| `attended` \| `no_show`), `source` (`web` \| `whatsapp` \| `admin`), `date` (exact slot date), `from` / `to` (slot date, inclusive), `slot` (id) |
| Export | `GET .../admin/bookings/export/` CSV / XLSX / PDF, `ids=`; audit entity `bookings` |
| Bulk | `POST .../admin/bookings/bulk/`: `confirm`, `cancel`, `attended`, `no_show`. `payload.notify` (default true) sends the confirmation email on confirm; `payload.note` is required for the attended ↔ no-show correction. Audit entity `bookings.booking` |
| Single row | `POST .../admin/bookings/<id>/<confirm\|cancel\|attended\|no_show\|reopen>/` body `{note?, notify?}`; same guard and capacity check as bulk, one audit row |
| Frontend | `/admin/visitas` (`?vista=reservas`, default): `estado`, `tipo`, `origen`, `desde`, `hasta`, `q`, `orden`, `page` |

Transition table (`apps/core/transitions.py`, `bookings.booking`): pending → confirmed \| cancelled \| no_show \| attended; confirmed → attended \| no_show \| cancelled; cancelled → pending (`reopen`, note required, capacity re-checked); attended ↔ no_show (note required). A move to pending or confirmed locks the slot (`select_for_update`) and sums `num_attendees` of the other pending/confirmed/attended bookings, the same rule as `create_booking` and `AvailabilitySlot.annotate_booked` (cancelled and no-show free their seats). Reschedule (`.../<id>/reschedule/`) uses the same count.

### Horarios: `GET /api/v1/bookings/admin/slots/`

| | |
|---|---|
| View | `AdminSlotListView` |
| Search (`q`) | `title`, `location` |
| Ordering keys | `date` (date + start), `start` (start + date), `type`, `capacity`, `booked` (annotated attendee total); default `-date` |
| Filters | `type`, `active` (`true` \| `false`), `from` / `to` (slot date, inclusive) |
| Export | `GET .../admin/slots/export/` CSV / XLSX / PDF, `ids=`; audit entity `bookings.slots` |
| Bulk | `POST .../admin/slots/bulk/`: `activate`, `deactivate`, `delete`. A slot with any booking (even cancelled) is never deleted: it comes back in `skipped` with the reason. Audit entity `bookings.availabilityslot` |
| Import | `GET .../admin/slots/import/template/`, `POST .../admin/slots/import/`. Columns `tipo` (individual \| puertas abiertas), `fecha` (DD/MM/AAAA), `inicio`, `fin` (HH:MM), `cupo` (1 to 1000), `lugar`, optional `titulo`. Matched on the unique tuple (tipo, fecha, inicio, fin): new → `crear` (`get_or_create`), existing with other cupo/lugar/titulo → `actualizar`, identical → `omitir`. Errors: past date, `fin` ≤ `inicio`, cupo below the seats already booked, duplicate tuple in the file |
| Frontend | `/admin/visitas?vista=horarios`: `activo`, `tipo`, `desde`, `hasta`, `q`, `orden`, `page` |

Query budgets (`apps/bookings/test_data_ops.py`): both lists are 2 queries (count + page) whatever the page size.
