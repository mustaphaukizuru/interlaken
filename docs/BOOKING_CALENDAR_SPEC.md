# Colegio Interlaken — Booking, Google Calendar & WhatsApp Spec

**Generated:** 2026-07-07 · Companion to [DEPLOY_HOSTINGER_VPS.md](DEPLOY_HOSTINGER_VPS.md), [STATUS_REPORT.md](STATUS_REPORT.md)

**Goal:** parents can book a school visit in **two situations**, the **admin controls availability**, confirmed bookings land on **Google Calendar**, and parents can also book **from WhatsApp**.

1. **Open class / Puertas Abiertas** — a scheduled **group** event (many families, fixed date, capacity).
2. **Individual visit** — a **new parent** requests a personal school tour; admin publishes **available slots**; parent picks one and confirms.

---

## 1. Current state

| Piece | Exists? | Notes |
|---|---|---|
| Group open-day model | ✅ `admissions.OpenSchoolDay` | has `event_name, event_date, event_time, max_capacity`, `spots_remaining` property |
| Group signup endpoint | ✅ `POST /api/v1/admissions/open-school/signup/` | creates a signup; **no** calendar/confirmation yet |
| Individual-visit availability | ❌ | needs new models |
| Individual-visit booking | ❌ | needs new models + slot picker UI |
| Google Calendar integration | ✅ (Prompt 13) | service-account event create/cancel, fail-soft + `sync_calendar` retry; needs GCP setup (DEPLOYMENT §8) |
| WhatsApp booking | ⚠️ partial | `WHATSAPP_NUMBER` in settings + `core/urls.py` wa.me redirect exist; no conversational booking |

So **type 1 is ~half-built**; **type 2 is new**; **Calendar + WhatsApp booking are new**.

---

## 2. Data model

Add an `apps/bookings/` app (or extend `admissions`). Unify around **availability → booking**:

```python
class VisitType(TextChoices):
    OPEN_CLASS = 'open_class', 'Clase Abierta / Puertas Abiertas'
    INDIVIDUAL = 'individual', 'Visita Individual'

class AvailabilitySlot:            # admin-published
    visit_type   = VisitType
    date         = DateField
    start_time   = TimeField
    end_time     = TimeField
    capacity     = PositiveInt      # 1 for individual, N for open class
    location     = CharField        # campus/room
    is_active    = Bool
    google_event_id = CharField     # the "master" calendar block, optional
    # booked_count via related bookings; is_full property

class Booking:
    slot         = FK(AvailabilitySlot, related_name='bookings')
    parent_name  = CharField
    parent_email = EmailField
    parent_phone = CharField
    child_name   = CharField(blank)
    child_grade  = CharField(blank)
    num_attendees= PositiveInt(default=1)
    status       = pending | confirmed | cancelled | attended | no_show
    source       = web | whatsapp | admin
    google_event_id  = CharField    # per-booking calendar event
    confirmation_sent= Bool
    notes        = TextField(blank)
    created_at   = DateTime
```

- **Type 1 (open class):** `AvailabilitySlot(visit_type=open_class, capacity=N)` — one slot, many `Booking`s. (Can migrate the existing `OpenSchoolDay` into this, or keep `OpenSchoolDay` and add `google_event_id`+confirmation. Unifying is cleaner long-term.)
- **Type 2 (individual):** admin creates `AvailabilitySlot(visit_type=individual, capacity=1)` per open time; a `Booking` fills it → slot becomes full.
- Capacity is enforced server-side (`select_for_update` on the slot to avoid double-booking races).

---

## 3. Google Calendar integration

> **✅ Implemented in Prompt 13 (Phase 2).** Code: `apps/bookings/services/calendar.py`
> (`create_event` / `update_event` / `cancel_event` + `sync_booking_created` /
> `sync_booking_cancelled` lifecycle helpers), wired into `bookings/views.py`
> (create/confirm → event, cancel → delete) and the `sync_calendar` retry command.
> **Fail-soft:** a booking never fails on a calendar error. **Manual GCP + env setup
> is required** for events to actually appear — set `GOOGLE_CALENDAR_ID` and `GOOGLE_CALENDAR_SA_KEY` in `deploy/.env`.

**Recommended: a service account writing to a shared school calendar** (server-side, no per-parent OAuth, cron-friendly).

- The provided `client_secret_…json` is a **Web OAuth client for login** — it is **not** usable for server-side Calendar writes. Create a **service account** in the same GCP project (`interlaken-project`), download its key JSON, and **share the school's Google Calendar** with the service account's email (Make changes to events).
- Enable **Google Calendar API** in the project.
- Add deps: `google-api-python-client`, `google-auth` (to `requirements.txt`).
- `apps/bookings/services/calendar.py`:
  - `create_event(booking) -> event_id` — title, description, start/end from the slot, `location`, **attendee = parent_email** (sends the Google invite/email automatically), reminders.
  - `cancel_event(event_id)`, `update_event(...)`.
- Store `event_id` on the `Booking`; deletion/cancellation removes the calendar event.
- **Confirmation:** Google's attendee invite covers the calendar email; also send our own branded confirmation email (cPanel SMTP) + optional WhatsApp message.

> Store the service-account key path in env (`GOOGLE_CALENDAR_SA_KEY`, `GOOGLE_CALENDAR_ID`); never commit the key.

---

## 4. Booking flows

### 4.1 Web — individual visit
```
Parent → "Agendar Visita" page → GET /api/v1/bookings/availability/?type=individual&from=&to=
   → calendar/slot picker shows open individual slots
Parent picks slot + fills contact → POST /api/v1/bookings/
   → server locks slot (select_for_update), checks capacity
   → Booking(status=confirmed, source=web)
   → Calendar event (invites parent) + confirmation email [+ WhatsApp]
   → 201 with confirmation details
```

### 4.2 Web — open class (reuse/extend existing)
Same shape, `type=open_class`; capacity = N; several bookings per slot; each booking still gets a confirmation (calendar invite to the group event).

### 4.3 Admin — availability management
- `POST /api/v1/bookings/availability/` (bulk: e.g. "Mon–Fri 9–11am, 30-min individual slots, next 2 weeks").
- `GET /api/v1/bookings/admin/bookings/?type=&status=&date=` — see/confirm/cancel/mark-attended.
- Recurring-slot generator (weekday + time range + interval → many slots).

---

## 5. WhatsApp booking (two tiers)

### Tier 1 — MVP (zero infra, ship now)
"**Reservar por WhatsApp**" button → `wa.me/<WHATSAPP_NUMBER>?text=…` deep link with a prefilled message ("Hola, quiero agendar una visita…"). Staff replies and creates the `Booking` in admin (`source=whatsapp`). You already have `WHATSAPP_NUMBER` + the `core/urls.py` wa.me redirect — this is a 1-hour add.

### Tier 2 — Conversational booking (WhatsApp Business Cloud API)
For self-service booking inside WhatsApp:
- Set up a **Meta WhatsApp Business (Cloud API)** number (or via Twilio/360dialog).
- Webhook endpoint `POST /api/v1/whatsapp/webhook/` (+ `GET` verify handshake). **Requires valid HTTPS** → depends on the SSL fix (DEPLOYMENT §1). Works fine under Passenger (it's just an HTTPS endpoint — no persistent worker needed).
- Flow: parent messages → bot lists next open slots (interactive list/buttons) → parent taps one → `Booking(source=whatsapp)` + Calendar event + WhatsApp confirmation.
- Verify Meta's `X-Hub-Signature-256` on every webhook call.

**Recommendation:** ship **Tier 1 now**, add **Tier 2** once the WABA number is approved (approval can take days).

---

## 6. New / changed endpoints

| Method + path | Purpose |
|---|---|
| `GET /api/v1/bookings/availability/?type=&from=&to=` | open slots for the picker |
| `POST /api/v1/bookings/` | create a booking (web) |
| `GET /api/v1/bookings/<id>/` | booking status/confirmation |
| `POST /api/v1/bookings/<id>/cancel/` | parent/admin cancel (removes calendar event) |
| `POST /api/v1/bookings/availability/` (admin) | publish slots (bulk/recurring) |
| `GET /api/v1/bookings/admin/bookings/` (admin) | manage bookings |
| `GET|POST /api/v1/whatsapp/webhook/` | WhatsApp Cloud API verify + messages |

Existing `admissions/open-school/*` either migrate here or gain `google_event_id` + confirmation.

---

## 7. Frontend

- **Public:** enhance `OpenSchoolPage` (exists) for group events; new **"Agendar Visita"** page with a **slot-picker calendar** (month/day → available times) for individual visits; both with a "Reservar por WhatsApp" fallback button.
- **Admin:** availability manager (recurring-slot builder) + bookings table (confirm/cancel/attended) under `/admin`.
- Ties into the UI plan's event-banner pattern (UI_UX_ENHANCEMENT_PLAN P10) — "Próxima Puertas Abiertas" can read live from `/bookings/availability/`.

---

## 8. Dependencies & prerequisites

- `requirements.txt`: **add** `google-api-python-client`, `google-auth`; (WhatsApp Tier 2 uses plain `requests` — already present).
- GCP `interlaken-project`: enable **Calendar API**, create **service account** + key, share school calendar.
- Env: `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_SA_KEY` (path), and for Tier 2 `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
- **Valid SSL** (DEPLOYMENT §1) — required for both Google OAuth and the WhatsApp webhook.
- Background reminders run via **cron management commands** (DEPLOYMENT §3), not Celery.

---

## 9. Suggested delivery phases

- **Phase 1 — Individual visits (web):** `bookings` app + models + availability admin + slot-picker page + capacity-safe booking. (No external deps yet — confirmations by email.)
- **Phase 2 — Google Calendar:** ✅ (Prompt 13) service account + event create/cancel + parent invites; fail-soft + `sync_calendar` retry cron. Requires manual GCP setup (DEPLOYMENT §8).
- **Phase 3 — Open class unification:** fold `OpenSchoolDay` into slots; live "Puertas Abiertas" banner.
- **Phase 4 — WhatsApp Tier 1** (deep link) → **Tier 2** (Cloud API bot) once the WABA number is approved.
