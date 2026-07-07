# Prompt 13 — Booking → Google Calendar (Phase 2)

**Run in:** fresh session at `D:\Github\interlaken`. **Prereqs:** 12. **Reference:** `BOOKING_CALENDAR_SPEC.md` §3, §8. **Size:** M.

## Context
See `prompts/README.md`. Confirmed bookings should appear on the school's Google Calendar and invite the parent. The provided `client_secret_…json` is a **Web OAuth login client**, NOT usable for server-side calendar writes — use a **service account** in the same GCP project (`interlaken-project`).

## Goal
Create/cancel Google Calendar events for bookings server-side, inviting the parent, without per-parent OAuth.

## Tasks
1. **Deps:** add `google-api-python-client` and `google-auth` to `backend/requirements.txt`.
2. **Prereqs doc:** in `DEPLOYMENT.md`/`BOOKING_CALENDAR_SPEC.md`, document the manual GCP steps — enable Calendar API, create a **service account** + key JSON, share the school calendar with the service-account email (Make changes to events). Add env `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_SA_KEY` (path). Never commit the key.
3. **Calendar service** `apps/bookings/services/calendar.py`:
   - `create_event(booking) -> event_id` (title, description, start/end from the slot, `location`, attendee = parent email → Google sends the invite, reminders).
   - `cancel_event(event_id)`, `update_event(...)`.
   - Fail soft: if calendar is unconfigured/unavailable, the booking still succeeds (log + queue for retry); never 500 the booking.
4. **Wire into booking lifecycle:** on confirm → create event, store `google_event_id`; on cancel → delete the event. Keep our own branded confirmation email too.
5. **Retry command:** `python manage.py sync_calendar` (cron) to create events for bookings that failed calendar creation.

## Constraints
- Booking must never fail because of a calendar error (fail soft + retry).
- Keep the service-account key out of git; read the path from env.

## Acceptance / verify
- `python manage.py check` passes; with a valid SA key + shared calendar, creating a booking makes a calendar event and the parent receives the Google invite; cancelling removes it.
- With calendar **unconfigured**, bookings still succeed and are picked up later by `sync_calendar`.

## Do NOT
- Use the login OAuth client for calendar writes. Commit the SA key. Block bookings on calendar availability.
