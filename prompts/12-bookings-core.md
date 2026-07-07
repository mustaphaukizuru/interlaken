# Prompt 12 — Booking Core: Availability & Individual Visits (Phase 1)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 02. **Reference:** `BOOKING_CALENDAR_SPEC.md` §2, §4, §6, §9. **Size:** L.

## Context
See `prompts/README.md`. Parents book in two situations: **open class (Puertas Abiertas)** — group event; and **individual visit** — a new parent tour where the admin publishes availability and the parent picks a slot. `admissions.OpenSchoolDay` already covers group events; individual visits are new.

## Goal
Build an availability + booking system (web), starting with individual visits, capacity-safe, confirmations by email — no external APIs yet.

## Tasks
1. **New `apps/bookings/` app** with models (see spec §2): `AvailabilitySlot` (`visit_type` ∈ open_class/individual, date, start/end, capacity, location, is_active, optional `google_event_id`) and `Booking` (slot FK, parent name/email/phone, child name/grade, num_attendees, status pending/confirmed/cancelled/attended/no_show, source web/whatsapp/admin, `google_event_id`, confirmation_sent, notes). Register in `INSTALLED_APPS`; migrations.
2. **Public endpoints:** `GET /api/v1/bookings/availability/?type=&from=&to=` (open slots), `POST /api/v1/bookings/` (create — lock the slot with `select_for_update`, enforce capacity), `GET /api/v1/bookings/<id>/`, `POST /api/v1/bookings/<id>/cancel/`.
3. **Admin endpoints:** `POST /api/v1/bookings/availability/` (bulk/recurring slot generator: weekday range + time window + interval), `GET /api/v1/bookings/admin/bookings/` (filter type/status/date), confirm/cancel/mark-attended.
4. **Confirmation email** on booking via `portal.services.notify` (Prompt 08 helper if present, else console email).
5. **Frontend:** new **"Agendar Visita"** public page with a month/day slot-picker for individual visits (+ a "Reservar por WhatsApp" fallback button using `WHATSAPP_NUMBER`); admin availability manager + bookings table under `/admin`.

## Constraints
- Capacity-safe: no double-booking (concurrency test). Spanish copy.
- No Google/WhatsApp APIs here (Prompts 13–14).

## Acceptance / verify
- `python manage.py check` + migrations apply.
- Admin generates individual slots; a parent books one → slot becomes full; a second booking for a full slot → 400. Cancel frees the slot.
- Booking sends a confirmation (console email in dev). `npx tsc --noEmit && npm run build` clean.

## Do NOT
- Integrate Google Calendar/WhatsApp yet. Break the existing `OpenSchoolDay` signup (that unifies in Prompt 14).
