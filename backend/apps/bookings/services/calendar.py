"""
bookings/services/calendar.py — Google Calendar events for confirmed bookings.

**Fail-soft by contract.** A booking must NEVER fail because of a calendar error
(unconfigured, key missing, Google unreachable, quota, permissions…). Every public
function here swallows its errors, logs them, and returns a falsy value so the
caller can carry on. Bookings that miss their event are picked up later by
``python manage.py sync_calendar`` (cron).

**Auth model.** A *service account* (NOT the OAuth login client) writes to a
shared school calendar — no per-parent OAuth, cron-friendly. Configure via env:
  - ``GOOGLE_CALENDAR_ID``      — the school calendar's id (…@group.calendar.google.com)
  - ``GOOGLE_CALENDAR_SA_KEY``  — filesystem path to the service-account key JSON
The service-account email must be granted "Make changes to events" on the calendar.

**Attendee invites.** We add the parent as an attendee with ``sendUpdates='all'``
so Google emails them the invite. Inviting attendees from a service account may
require Domain-Wide Delegation; if Google refuses the attendee, we retry once
without attendees so the event itself still lands (our own branded email in
``notifications.py`` always covers the parent regardless). See BOOKING_CALENDAR_SPEC §3.
"""
import datetime
import logging
import os

from django.conf import settings

logger = logging.getLogger(__name__)

# OAuth scope for read/write access to calendar events.
_SCOPES = ['https://www.googleapis.com/auth/calendar']

# Default pop-up + email reminders on each event.
_REMINDERS = {
    'useDefault': False,
    'overrides': [
        {'method': 'email', 'minutes': 24 * 60},
        {'method': 'popup', 'minutes': 60},
    ],
}


def is_configured():
    """True only if both env values are set and the key file exists on disk."""
    calendar_id = getattr(settings, 'GOOGLE_CALENDAR_ID', '')
    key_path = getattr(settings, 'GOOGLE_CALENDAR_SA_KEY', '')
    return bool(calendar_id and key_path and os.path.isfile(key_path))


def _get_service():
    """Build an authenticated Calendar API client, or None if unavailable.

    Never raises: a missing dependency, bad key, or misconfiguration returns None
    so callers stay fail-soft.
    """
    if not is_configured():
        return None
    try:
        # Imported lazily so the app runs (and tests pass) without the Google
        # libraries installed — they're only needed when calendar is configured.
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        credentials = service_account.Credentials.from_service_account_file(
            settings.GOOGLE_CALENDAR_SA_KEY, scopes=_SCOPES,
        )
        # cache_discovery=False avoids a noisy warning + file cache on cPanel.
        return build('calendar', 'v3', credentials=credentials, cache_discovery=False)
    except Exception as exc:  # ImportError, auth error, malformed key…
        logger.warning('Google Calendar client unavailable: %s', exc)
        return None


def _event_body(booking, *, with_attendee=True):
    """Build the Calendar event payload from a booking's slot."""
    slot = booking.slot
    tz = settings.TIME_ZONE
    start_dt = datetime.datetime.combine(slot.date, slot.start_time)
    end_dt = datetime.datetime.combine(slot.date, slot.end_time)

    visit_label = slot.get_visit_type_display()
    summary = f'Visita Interlaken — {booking.parent_name} ({visit_label})'
    description = (
        f'Reserva de visita ({visit_label})\n'
        f'Padre/tutor: {booking.parent_name}\n'
        f'Correo: {booking.parent_email}\n'
        f'Teléfono: {booking.parent_phone}\n'
        f'Alumno: {booking.child_name or "—"}\n'
        f'Grado de interés: {booking.child_grade or "—"}\n'
        f'Asistentes: {booking.num_attendees}\n'
        f'Reserva #{booking.id}'
    )

    body = {
        'summary': summary,
        'description': description,
        'location': slot.location or 'Campus Interlaken',
        'start': {'dateTime': start_dt.isoformat(), 'timeZone': tz},
        'end': {'dateTime': end_dt.isoformat(), 'timeZone': tz},
        'reminders': _REMINDERS,
    }
    if with_attendee and booking.parent_email:
        body['attendees'] = [{'email': booking.parent_email}]
    return body


def create_event(booking):
    """Create a calendar event for ``booking``; return its event id or ''.

    Fail-soft: returns '' on any error so the booking is unaffected. Invites the
    parent (sendUpdates='all'); if the service account can't add attendees, retries
    once without them so the event still lands.
    """
    service = _get_service()
    if service is None:
        return ''

    calendar_id = settings.GOOGLE_CALENDAR_ID
    try:
        event = service.events().insert(
            calendarId=calendar_id,
            body=_event_body(booking, with_attendee=True),
            sendUpdates='all',
        ).execute()
        return event.get('id', '')
    except Exception as exc:
        # Most commonly: "Service accounts cannot invite attendees without
        # Domain-Wide Delegation." Retry without the attendee so the event lands;
        # our branded email still notifies the parent.
        logger.warning('Calendar event with attendee failed for booking %s: %s',
                       booking.id, exc)
        try:
            event = service.events().insert(
                calendarId=calendar_id,
                body=_event_body(booking, with_attendee=False),
            ).execute()
            return event.get('id', '')
        except Exception as exc2:
            logger.error('Calendar event creation failed for booking %s: %s',
                         booking.id, exc2)
            return ''


def update_event(booking):
    """Patch the calendar event tied to ``booking``; return its id or ''.

    If the booking has no event yet, falls through to ``create_event``. Fail-soft.
    """
    if not booking.google_event_id:
        return create_event(booking)

    service = _get_service()
    if service is None:
        return ''

    try:
        event = service.events().patch(
            calendarId=settings.GOOGLE_CALENDAR_ID,
            eventId=booking.google_event_id,
            body=_event_body(booking, with_attendee=True),
            sendUpdates='all',
        ).execute()
        return event.get('id', '')
    except Exception as exc:
        logger.error('Calendar event update failed for booking %s: %s',
                     booking.id, exc)
        return ''


def cancel_event(event_id):
    """Delete a calendar event by id; return True on success. Fail-soft.

    A 404/410 (already gone) is treated as success — the desired end state (no
    event) holds either way.
    """
    if not event_id:
        return False
    service = _get_service()
    if service is None:
        return False

    try:
        service.events().delete(
            calendarId=settings.GOOGLE_CALENDAR_ID,
            eventId=event_id,
            sendUpdates='all',
        ).execute()
        return True
    except Exception as exc:
        # If the event is already gone, consider the cancellation done.
        status_code = getattr(getattr(exc, 'resp', None), 'status', None)
        if status_code in (404, 410):
            return True
        logger.error('Calendar event deletion failed (%s): %s', event_id, exc)
        return False


# ── Booking-lifecycle helpers (keep views/commands tidy) ──────────────────────

def sync_booking_created(booking):
    """Create the calendar event for a freshly confirmed booking and store its id.

    No-op if calendar is unconfigured or the booking already has an event. Never
    raises; on failure the empty ``google_event_id`` flags it for ``sync_calendar``.
    """
    if booking.google_event_id or not is_configured():
        return ''
    event_id = create_event(booking)
    if event_id:
        booking.google_event_id = event_id
        booking.save(update_fields=['google_event_id', 'updated_at'])
    return event_id


def sync_booking_cancelled(booking):
    """Delete the booking's calendar event (if any) and clear the stored id."""
    event_id = booking.google_event_id
    if not event_id:
        return False
    ok = cancel_event(event_id)
    if ok:
        booking.google_event_id = ''
        booking.save(update_fields=['google_event_id', 'updated_at'])
    return ok
