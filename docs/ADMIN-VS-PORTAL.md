# Django admin vs. Portal: who owns what

Two back-offices exist and they must not overlap. The rule:

| | **Portal staff console** (`/admin/*`, React) | **Django admin** (`/admin/` backend, Unfold) |
|---|---|---|
| **Audience** | School staff (`role = admin`): secretaría, dirección, cafetería | Superusers / technical operator only |
| **Purpose** | Day-to-day operations on people and money | System of record: auth, permissions, CMS content, legal records, raw ledgers |
| **Style** | Guided workflows, validation, audit context, Spanish UX | Raw model tables; read-mostly |
| **Creates data?** | Yes (students, families, adjustments, announcements, slots) | Only auth/config/content. Never people or money |

If a thing can be done in the portal, it is **removed** from the Django admin (or made read-only there). The Django admin is not a second UI for the same job.

## 1. Portal staff console must have (operational source of truth)

| Area | Screens / actions | Notes |
|---|---|---|
| Dashboard | KPIs, charts, pending queues | `/admin` |
| **Students and families** | List/search, create, edit student (grade, group, student_id, active), **student email**, **guardian/parent emails and phones**, link/unlink guardians, set/reset family password, import students CSV, Loyverse link | `/admin/alumnos`, `/admin/alumnos/:id`. This is the only place staff edit people. |
| Admissions | Pre-registration queue, invite, review registration, documents verify/reject, retention report | `/admin/admisiones` |
| Visits / bookings | Availability slots CRUD, bookings list, confirm/cancel | `/admin/visitas` |
| **Cafetería (the only money path)** | Balances, transactions, top-up review (cash / POS), manual balance adjustments with reason, refunds, low-balance alerts, Loyverse link, exports | `/admin/cafeteria`, `/admin/cafeteria/:id` |
| Online payments | Family-scoped history of cafetería top-up payments (read), refund trigger | Surfaced inside Cafetería; no standalone ledger editor |
| Communications | Comunicados (create, target, schedule, send email/WhatsApp/push), comments moderation, emergency broadcast, mark-all-read stats | `/admin/comunicados` |
| Audit | Searchable audit log (who / what / why) | `/admin/auditoria` (read-only) |
| Operational settings | School-year, cafetería thresholds, notification toggles | `/admin/ajustes` |

## 2. Django admin must have (and nothing else in the sidebar)

| Group | Models | Mode |
|---|---|---|
| **Acceso y seguridad** | `accounts.User` (auth record only: email as login id, role, `is_active`, `is_staff`, groups, last login; **no profile fields**), `auth.Group` / permissions, axes lockouts | Edit |
| **Contenido del sitio (CMS)** | `content.SiteSettings`, public price list (`TuitionCost`, `EnrollmentFee`, `FixedConcept`, `ExtracurricularActivity`, `DaycareRate`, `PricingPolicy`), privacy-notice versions | Edit. This is *published information* for the website's Costos page, not billing. |
| **Legal** | `legal.ConsentRecord`, `legal.ArcoRequest` | Read / status only |
| **Sistema** | `core.AuditLog`, `core.ContactMessage`, `portal.Notification` (raw), `payments.Payment` (gateway ledger), `cafeteria.LoyverseProfile` (sync mirror) | **Read-only** (`has_add_permission = False`, `has_delete_permission = False`) |

## 3. Remove from the Django admin sidebar (duplicates of portal screens)

Status 2026-08-22: cafetería money rows, visit slots/bookings and comunicados are now read-only in the Django admin (no add/delete) and gone from the sidebar. **Alumnos / Padres y tutores stay for now**: the portal API only lists students (`GET /accounts/students/`), imports CSV, links guardians and sets passwords; it has no create/edit endpoint. They move out once the portal has a student/family editor (emails, grade, group, phones).

These are registered today and duplicate portal workflows; they bypass the portal's validation, audit context and notifications:

- Familias → **Alumnos** (`StudentProfile`), **Padres y tutores** (`ParentProfile`). Student and guardian emails belong to the portal student file, not here. The `User` row stays only as the auth record.
- Admisiones → Pre-registros, Inscripciones, Documentos, Disponibilidad, Reservas.
- Cafetería → Saldos, Transacciones, Solicitudes de recarga, Ajustes de saldo (keep *Perfiles de Loyverse* read-only under Sistema).
- Comunicaciones → Comunicados, Comentarios (keep Notificaciones raw, read-only; keep Mensajes de contacto).

## 4. Money scope (decided 2026-08-22)

The app sells **cafetería wallet top-ups only**. Colegiatura (tuition) and inscripción (enrollment) are **not** billed, invoiced, reminded, or paid through the app:

- `apps.finance` is retired: migration `finance.0006` drops `FeeSchedule`, `Discount`, `Invoice`, `InvoiceLineItem`, `InvoicePayment`, `InvoiceAdjustment`.
- `payments.Payment.Type` is `cafeteria` | `other` (legacy rows of the retired types were folded into `other` by `payments.0004`).
- Django admin `Pagos en línea` is read-only (no add/delete): payments are minted by the top-up flow and settled by signed webhooks only.
- The public **Costos** page (content app) remains: it publishes the school's price list; it does not charge anything.
