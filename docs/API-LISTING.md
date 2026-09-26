# Admin list contracts (Data Ops round)

One row per admin list endpoint: what `?q=` searches, the whitelisted `?ordering=` keys (the frontend column `sortKey` values are the same strings; a backend test pins each set against the frontend constant), the filters, the export formats and the bulk actions. Every list follows C1 (`page`, `page_size` ≤ 100, `-pk` tiebreak, unknown filter values ignored, dates as aware America/Mexico_City bounds `from` ≤ day ≤ `to`). Every export follows C3 (`GET …/export/?fmt=csv|xlsx|pdf&ids=…` plus the list's own params; caps 10,000 CSV/XLSX and 1,000 PDF answered with 413; throttle `admin-export`; one `AuditLog` row `export:<entity>` per download). Every bulk endpoint follows C5 (`POST …/bulk/`, ≤ 500 ids or `all_matching` ≤ 2,000 with the list's filters, `dry_run`, per-row audit plus a `bulk:<entity>` summary; throttle `admin-bulk`).

Sections are appended per phase. Keep the table in sync with the view's `search_fields`, `ordering` and `filterset_class`.

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
