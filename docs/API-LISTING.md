# Admin list contract: endpoints, keys, filters, exports, bulk, imports

The reference for the Data Operations round (docs/DATA-OPS-PROMPT.md, contracts C1 to C5). Every admin list answers DRF `{count, next, previous, results}` with `page` and `page_size` (20 by default, 100 max), searches with `q` and sorts with `ordering=[-]<key>` over the whitelist below (unknown keys fall back to the default; a `-pk` tiebreak is always appended). Exports are the list itself with another renderer (`GET …/export/?fmt=csv|xlsx|pdf&ids=1,2,3` plus the same filters, caps 10,000 rows CSV/XLSX and 1,000 PDF, throttle `admin-export`). Bulk is `POST …/bulk/ {action, ids ≤ 500 | all_matching + filters ≤ 2,000, payload, dry_run}` (throttle `admin-bulk`). Imports are `GET …/import/template/?fmt=` and `POST …/import/` (multipart `file`, `dry_run`, `report`, `valid_only`; 2,000 rows / 5 MB, throttle `admin-import`). Everything that writes or exports is audited.

Each phase appends its section. The frontend mirrors every ordering whitelist in `frontend/src/hooks/queries/*` (`*_ORDERING_KEYS`).

## Phase 8: Comunicados y Contenido

Base path `/api/v1`. Permissions: `IsAdmin` unless noted.

| List | Search `q` | Ordering keys (default) | Filters | Export | Bulk actions | Import |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /portal/admin/announcements/` | title, body | `created`, `publish_at`, `title`, `audience`, `reads`, `active` (`-created`) | `audience`, `active` (1/0), `scheduled` (1/0: `publish_at` in the future), `requires_ack` (1/0), `from`/`to` (created) | `…/export/` CSV, XLSX | `activate` (first activation fans out once), `deactivate` (archive), `delete` (only never fanned out), `duplicate` (inactive draft copy) | n/a |
| `GET /portal/admin/announcements/<id>/delivery/export/` | n/a | recipient name | n/a | CSV, XLSX: one row per recipient (read, enterado, email/push status, attempts, last error) | n/a | n/a |
| `GET /content/admin/pages/` (admin or staff) | title, slug | `title`, `slug`, `status`, `template`, `updated`, `published`, `created` (`slug`) | `status`, `template`, `review` (1/0: approval requested) | `…/export/` CSV, XLSX, PDF (admin) | `publish` (pre-publish checks per row; errors fail the row), `unpublish`, `delete` (drafts never published only) (admin) | n/a |
| `GET /content/admin/media/` (admin or staff) | filename, alt, caption, tags | `created`, `filename`, `size`, `type`, `alt` (`-created`) | `type` (jpeg, png, webp, gif), `unreferenced` (1/0), `missing_alt` (1/0), `from`/`to` | `…/export/` CSV, XLSX, PDF | `delete` (unreferenced only), `add_tag` (payload `tag`) (admin or staff) | upload: `POST` one file per request; same sha256 → 409 `{detail, existing}` |
| `GET /content/admin/forms/` | title, slug | `title`, `slug`, `updated`, `submissions`, `pending`, `published` (`title`) | `published` (1/0) | `…/export/` CSV, XLSX, PDF | `delete` (forms without submissions only) | n/a |
| `GET /content/admin/forms/<id>/submissions/` (or `?form=<id>`) | every answer (`search_text`) | `date`, `handled`, `page` (`-date`) | `handled` (1/0), `from`/`to` | `…/submissions/export/` CSV, XLSX, PDF, one column per form field (replaces `?export=csv`) | `POST /content/admin/form-submissions/bulk/`: `mark_handled`, `reopen`, `delete` (`all_matching` filters carry `form`) | n/a |
| `GET /content/admin/redirects/` | from_path, to_path | `from`, `to`, `permanent`, `hits`, `created` (`from`) | `permanent` (1/0) | `…/export/` CSV, XLSX, PDF (headers `de, a, permanente` match the import) | `delete` | `de`, `a`, `permanente`; dedupe `de` (file and DB: an existing path is updated, an identical one is omitted) |
| `GET /content/admin/testimonials/` | quote, author, role | `order`, `author`, `level`, `published`, `created` (`order, -created`) | `published` (1/0), `level` (`general` = empty) | `…/export/` CSV, XLSX, PDF | `publish`, `unpublish`, `delete` | n/a |
| `GET /content/admin/calendar/` | title, description | `start`, `end`, `title`, `kind`, `level`, `published`, `updated` (`start, title`) | `kind`, `level` (`todos` = all levels), `published` (1/0), `from`/`to` (events overlapping the range) | `…/export/` CSV, XLSX, PDF | `publish`, `unpublish`, `delete` | `titulo`, `tipo`, `inicio`, `fin` (DD/MM/YYYY), `nivel`, `descripcion`, `publicado`; dedupe (`titulo`, `inicio`); DB match by title (case-insensitive) + start date → update |

Public: `GET /content/calendar.ics` (published events from one year back, all-day VEVENTs, RFC 5545 folding, cached 10 minutes, cleared on every calendar write; see docs/OPS-RUNBOOK.md section 8).

Audit contexts: `portal.announcement`, `cms.page`, `cms.publish`/`cms.unpublish`, `cms.media`, `cms.form`, `cms.form-submission`, `cms.redirect`, `cms.testimonial`, `cms.calendar`; bulk rows `bulk:<entity>:<action>` plus one `bulk:<entity>` summary; imports `import:<entity>`; exports `export:<entity>`.

Guards: a comunicado's activation follows the `portal.announcement` transition table (draft/inactive ↔ active) on both the single PATCH and bulk; a comunicado already sent to families (`fanout_at`) cannot be deleted, single or bulk (deactivate archives it).
