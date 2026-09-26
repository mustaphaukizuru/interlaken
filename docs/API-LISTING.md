# API listing contract: endpoints, search, ordering, filters, exports

One row per list endpoint of the Data Operations round (`docs/DATA-OPS-PROMPT.md` Part B, contracts C1 to C3): what `?q=` searches, the whitelisted `?ordering=[-]<key>` keys (the frontend sends the same strings; an unknown key falls back to the default and a `-pk` tiebreak is always appended), the filters and the export formats. Lists answer `{count, next, previous, results}` with `?page=` and `?page_size=` (at most 100). Date filters `?from=` / `?to=` are inclusive ISO dates applied as aware America/Mexico_City bounds. Exports take the list's own params plus `?fmt=`; over the row cap they answer 413 `{"detail": "Acote los filtros: el límite es N filas."}` and every download writes one `AuditLog` row with `object_type='export:<entity>'` (filters and row count in `changes`).

Sections are appended per phase. Keep each table in sync with the view's ordering whitelist and filters.

## Portal de familias (Phase 9)

Family-scoped lists: a parent sees only their linked children, a student login only their own profile, an admin everything; another family's `student` id yields an empty list or file, never their rows. Staff are refused on the cafetería export. No search, no bulk actions and no imports in the portal. Each export subclasses its list view, so scoping, filters and ordering are the same code; formats are CSV (UTF-8 BOM, CRLF) and XLSX (real dates and numbers), capped at 10,000 rows, throttled under `portal-export` (30/min per user) and audited with `context='portal'`.

| Endpoint | Ordering keys (default) | Filters | Export | Frontend |
| --- | --- | --- | --- | --- |
| `GET /api/v1/cafeteria/transactions/` | `date`, `amount`, `type`, `balance` (`-date`) | `student` (profile id), `type` (`purchase`, `topup`, `refund`), `from`, `to` | `GET /api/v1/cafeteria/export/?fmt=csv\|xlsx` + same params; entity `cafeteria.family_transactions`; columns Alumno, Matrícula, Fecha, Tipo, Descripción, Monto, Saldo | `pages/parent/CafeteriaPage.tsx` |
| `GET /api/v1/payments/history/` | `date`, `amount`, `status`, `gateway` (`-date`); the portal offers `date`, `amount`, `status` | `status`, `student` (profile id), `from`, `to` | `GET /api/v1/payments/history/export/?fmt=csv\|xlsx` + same params; entity `payments.family`; columns Fecha, Alumno, Concepto, Monto, Moneda, Estado, Pasarela, Referencia | `pages/parent/PaymentsPage.tsx` |
| `GET /api/v1/portal/announcements/` | fixed (newest first) | none (audience-scoped server-side) | n/a | `pages/parent/ComunicadosPage.tsx` |
| `GET /api/v1/portal/notifications/` | fixed (`-created_at`) | `type` (`info`, `warning`, `payment`, `cafeteria`), `unread=1` | n/a | `pages/parent/NotificationsPage.tsx` |
| `GET /api/v1/admissions/my-registrations/` | fixed | none server-side (a family has a handful; `?estado=` filters in the page) | n/a | `pages/parent/InscripcionesPage.tsx` |

Unchanged documents: the monthly cafetería statement (`GET /api/v1/cafeteria/statement/?student=&month=YYYY-MM`, PDF) and the payment comprobante (`GET /api/v1/payments/<id>/receipt/`, PDF).

Frontend URL vocabulary on these pages: `orden` → `ordering`, `page`, `alumno` → `student`, `tipo` → `type`, `estado` → `status`, `desde` / `hasta` → `from` / `to`, `sin_leer` → `unread`. On Cafetería, `?alumno=` is kept in step with the portal child switcher (the last one changed wins). A bookmarked `?page=` past the end (DRF 404) falls back to page 1.
