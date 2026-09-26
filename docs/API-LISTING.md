# API listing contract: endpoints, search, ordering, filters, exports, bulk, import

The admin lists follow one contract (Data Operations round, `docs/DATA-OPS-PROMPT.md` Part B, C1 to C5):

- `?q=` searches the fields listed below (every term must match somewhere; accent-insensitive on Postgres).
- `?ordering=[-]<key>` accepts only the keys listed below; an unknown key falls back to the default. A `-pk` tiebreak is always appended.
- `?page=` and `?page_size=` (at most 100). Response: `{count, next, previous, results}` unless noted.
- Date filters `?from=` / `?to=` are inclusive ISO dates, applied as aware America/Mexico_City bounds.
- Export siblings (`.../export/?fmt=csv|xlsx|pdf&ids=...`) take the same params as the list. Caps: 10,000 rows (CSV/XLSX), 1,000 (PDF), 500 `ids`; over cap answers 413. Every export writes an `export:<entity>` audit row. Throttle `admin-export` 30/min.
- Bulk (`POST .../bulk/`): `{action, ids (max 500), all_matching, filters, payload, dry_run}` → `{action, requested, ok, failed, skipped, dry_run}`. One audit row per processed row plus one `bulk:<entity>` summary. Throttle `admin-bulk` 30/min.
- Import (`POST .../import/`, `GET .../import/template/?fmt=csv|xlsx`): multipart `file`, `dry_run=1` (default), `report=csv|xlsx`, `valid_only=1`. Throttle `admin-import` 10/min.

The frontend sort keys live next to the hooks (`frontend/src/hooks/queries/<entity>.ts`); a backend test pins each whitelist.

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
