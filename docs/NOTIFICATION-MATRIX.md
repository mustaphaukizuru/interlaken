# Notification matrix (BACKLOG P1-C2)

Who receives what, through which channel. Enforced in code by `apps.portal.services.notify()`
(in-app + email + push, with guardian fan-out for students via `apps.accounts.recipients`) and the
cafetería/bookings/admissions services that call it. Email always sends plain text plus the branded
HTML alternative (`templates/email/base.html`), `From: noreply@interlaken.edu.mx`,
`Reply-To: CONTACT_EMAIL` (info@interlaken.com.mx) unless the event says otherwise.

Legend: **S** student's real mailbox (never the synthetic `@alumnos.` login), **G** every active
guardian, **A** admins/staff inbox, **F** the family that asked (parent or student user).
Channels: in-app bell, email, web push, WhatsApp (only when the user has a number and the event
is marked WA).

| Event | Trigger | Audience | In-app | Email | Push | WhatsApp | Reply-To |
|-------|---------|----------|--------|-------|------|----------|----------|
| Comunicado publicado / activado | admin publishes | all users in audience (families, staff) | yes | yes (batched cron, 7-day staleness cut-off) | yes if `push_enabled` | no | info@ |
| Emergencia (broadcast) | admin | all active families + staff | yes | yes (first batch inline) | yes | no | info@ |
| Recarga aplicada (top-up credited) | webhook / caja | S + G | yes | yes | yes | WA | cafeteria@ |
| Recarga solicitada (pago en caja) | family | S + G (confirmation) and A (to apply) | yes | yes | yes | no | cafeteria@ |
| Saldo bajo | nightly `low_balance_alerts` | S + G | yes | yes | yes | WA | cafeteria@ |
| Consumo diario / resumen semanal | `send_spending_digest` | G (and S if real email) | no | yes | no | WA (digest) | cafeteria@ |
| Pago fallido / reembolsado | gateway webhook | S + G | yes | yes | yes | no | pagos@ |
| Ajuste manual de saldo | admin | S + G | yes | yes | no | no | cafeteria@ |
| Pre-registro recibido | public form | applicant (confirmation) and A (`ADMISSIONS_EMAIL`) | no | yes | no | no | admisiones@ / applicant |
| Invitación a inscripción | admin | applicant | no | yes | no | no | admisiones@ |
| Documento aprobado / rechazado | admin review | applicant | no | yes | no | no | admisiones@ |
| Admisión aceptada (cuentas creadas) | admin converts | G | no | yes | no | WA (credentials via template) | soporte@ |
| Visita confirmada | booking | visitor | no | yes (+ .ics) | no | WA | admisiones@ |
| Recordatorio de visita (24h) | `send_visit_reminders` | visitor | no | yes | no | WA | admisiones@ |
| Contraseña asignada por admin | inbox resolve / reset dialog | F | no | manual (admin sends template by WA or email) | no | manual | soporte@ |
| Mensaje del formulario de contacto | public form | A (`CONTACT_EMAIL`) | no | yes | no | no | visitor's email |
| Cambio de estado del alumno (baja/egreso) | admin | G | yes | yes | no | no | direccion@ |

Rules that apply everywhere:

1. A student-addressed event always reaches the guardians (`notify(fanout=True)`); callers that
   already iterate the family pass `fanout=False` so nobody is notified twice.
2. Inactive users and synthetic student addresses never receive email.
3. `NotificationPreference` toggles (email / in-app / push) are honored per user; emergency
   broadcasts ignore the email toggle only when `emergency=True`.
4. Per-recipient delivery status, retries and bounce tracking: BACKLOG P1-C5.
5. Per-category preferences, quiet hours and per-child selection: BACKLOG P1-C4.
