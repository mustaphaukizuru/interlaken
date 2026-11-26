"""
bookings/services/calendar.py — Google Calendar events for confirmed bookings.

**Fail-soft by contract.** A booking must NEVER fail because of a calendar error
(unconfigured, key missing, Google unreachable, quota, permissions…). Every public
function here swallows its errors, logs them, and returns a falsy value so the
caller can carry on. Bookings that miss their event are picked up later by
``python manage.py sync_calendar`` (cron).

**Auth model.** A *service account* (NOT the OAuth login client) writes to a
shared school calendar: no per-parent OAuth, cron-friendly. Configure via env
(step by step: docs/GOOGLE_CALENDAR.md):
  - ``GOOGLE_CALENDAR_ID``      the school calendar's id (…@group.calendar.google.com)
  - ``GOOGLE_CALENDAR_SA_KEY``  filesystem PATH of the service-account key JSON
The service-account email must be granted «Hacer cambios en los eventos» on the
calendar. ``python manage.py sync_calendar --check`` says whether it is.

Until 2026-11-26 production held the Google sign-in client's id and secret in
these two variables, so nothing was ever written to a calendar and nothing said
why. ``diagnose()`` names the wrong variable (never its value) in the daily
``sync_calendar`` output and in one warning per process.

**Family invites.** Off unless ``GOOGLE_CALENDAR_INVITE_FAMILY``: the family
already gets the school's branded email with an .ics (``notifications.py``), and
a service account without domain-wide delegation may not invite attendees
(Google refuses; we then retry without them). With it off, Google sends nobody
anything (``sendUpdates='none'``). See BOOKING_CALENDAR_SPEC §3.
"""
import datetime
import json
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

# What the two sign-in credentials look like: the values production held.
_OAUTH_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com'
_OAUTH_SECRET_PREFIX = 'GOCSPX-'

GUIDE = 'docs/GOOGLE_CALENDAR.md'


def _calendar_id() -> str:
    return (getattr(settings, 'GOOGLE_CALENDAR_ID', '') or '').strip()


def _key_path() -> str:
    return (getattr(settings, 'GOOGLE_CALENDAR_SA_KEY', '') or '').strip()


def invite_family() -> bool:
    return bool(getattr(settings, 'GOOGLE_CALENDAR_INVITE_FAMILY', False))


def _send_updates() -> str:
    """Google emails the attendees only when we invite the family."""
    return 'all' if invite_family() else 'none'


def _id_looks_valid(calendar_id: str) -> bool:
    return (bool(calendar_id) and not calendar_id.endswith(_OAUTH_CLIENT_ID_SUFFIX)
            and ('@' in calendar_id or calendar_id == 'primary'))


def is_attempted() -> bool:
    """True when someone set either variable (the calendar is meant to be on)."""
    return bool(_calendar_id() or _key_path())


def is_configured():
    """True only if the calendar id looks like one and the key file exists.

    Cheap (no file read): it runs on every booking. ``diagnose`` says why not.
    """
    return _id_looks_valid(_calendar_id()) and bool(_key_path()) and os.path.isfile(_key_path())


def _read_key(path: str):
    """``(data, problem)``: the parsed key file, or why it is not usable."""
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
    except PermissionError:
        return None, (f'No se puede leer {path}: el archivo debe pertenecer al usuario del '
                      'contenedor (chown 10001:10001) con permisos 600.')
    except (OSError, ValueError):
        return None, (f'{path} no es un archivo JSON válido: descargue de nuevo la clave de la '
                      'cuenta de servicio.')
    if (not isinstance(data, dict) or data.get('type') != 'service_account'
            or not data.get('client_email') or not data.get('private_key')):
        return None, (f'{path} no es una clave de cuenta de servicio de Google '
                      '(debe tener "type": "service_account", "client_email" y "private_key").')
    return data, None


def diagnose() -> list[str]:
    """What keeps the calendar off, one sentence per problem, in Spanish.

    Names the variable and what is wrong with it, never its value (both may be
    secrets); a key PATH is shown only once it is an absolute path. An empty
    list means configured and readable.
    """
    problems = []
    calendar_id = _calendar_id()
    if not calendar_id:
        problems.append('GOOGLE_CALENDAR_ID está vacío: falta el id del calendario '
                        '(termina en @group.calendar.google.com).')
    elif calendar_id.endswith(_OAUTH_CLIENT_ID_SUFFIX):
        problems.append('GOOGLE_CALENDAR_ID contiene el id del cliente de inicio de sesión con Google, '
                        'no el id de un calendario (termina en @group.calendar.google.com).')
    elif not _id_looks_valid(calendar_id):
        problems.append('GOOGLE_CALENDAR_ID no parece el id de un calendario: debe terminar en '
                        '@group.calendar.google.com (o ser el correo del calendario).')

    path = _key_path()
    if not path:
        problems.append('GOOGLE_CALENDAR_SA_KEY está vacío: falta la ruta del archivo JSON de la '
                        'cuenta de servicio.')
    elif path.startswith(_OAUTH_SECRET_PREFIX):
        problems.append('GOOGLE_CALENDAR_SA_KEY contiene el secreto del cliente de inicio de sesión con '
                        'Google, no la ruta de un archivo. Ese secreto no sirve para el calendario.')
    elif not os.path.isabs(path):
        problems.append('GOOGLE_CALENDAR_SA_KEY no es la ruta de un archivo: en el servidor debe ser '
                        '/run/secrets/interlaken/google-calendar.json.')
    elif not os.path.isfile(path):
        problems.append(f'GOOGLE_CALENDAR_SA_KEY apunta a {path}, que no existe en el servidor: copie ahí '
                        f'la clave de la cuenta de servicio ({GUIDE}).')
    else:
        _data, problem = _read_key(path)
        if problem:
            problems.append(problem)
    return problems


def service_account_email() -> str:
    """The address the calendar must be shared with ('' when the key is unusable)."""
    path = _key_path()
    if not path or not os.path.isabs(path) or not os.path.isfile(path):
        return ''
    data, _problem = _read_key(path)
    return (data or {}).get('client_email', '')


_warned_unconfigured = False


def _warn_if_half_configured():
    """One warning per process when the calendar is meant to be on but cannot
    be (the state production was in): the log says which variable is wrong."""
    global _warned_unconfigured
    if _warned_unconfigured or not is_attempted():
        return
    _warned_unconfigured = True
    logger.warning('Google Calendar no está configurado; las visitas no llegan al calendario. %s',
                   ' '.join(diagnose()))


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
            _key_path(), scopes=_SCOPES,
        )
        # cache_discovery=False avoids a noisy warning + file cache in the container.
        return build('calendar', 'v3', credentials=credentials, cache_discovery=False)
    except Exception as exc:  # ImportError, auth error, malformed key…
        logger.warning('Google Calendar client unavailable: %s', exc)
        return None


def _summary(booking) -> str:
    from apps.core.plurals import count

    slot = booking.slot
    name = booking.parent_name or 'Familia'
    if slot.visit_type == 'open_class':
        people = count(booking.num_attendees, 'asistente', 'asistentes')
        return f'{slot.title or "Puertas Abiertas"}: {name} ({people})'
    return f'Visita individual: {name}'


def _description(booking) -> str:
    from apps.portal.emailing import portal_url

    from .staff_alerts import details, visits_path

    # The event itself already shows the date, the time and the place.
    rows = [f'{label}: {value}' for label, value in details(booking)
            if label not in ('Fecha', 'Horario', 'Lugar')]
    rows.append(f'Reserva #{booking.id}')
    rows.append(f'Abrir en la consola: {portal_url(visits_path(booking))}')
    return '\n'.join(rows)


def _event_body(booking, *, with_attendee=None):
    """Build the Calendar event payload from a booking's slot.

    ``with_attendee`` defaults to ``GOOGLE_CALENDAR_INVITE_FAMILY``."""
    if with_attendee is None:
        with_attendee = invite_family()
    slot = booking.slot
    tz = settings.TIME_ZONE
    start_dt = datetime.datetime.combine(slot.date, slot.start_time)
    end_dt = datetime.datetime.combine(slot.date, slot.end_time)

    body = {
        'summary': _summary(booking),
        'description': _description(booking),
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

    Fail-soft: returns '' on any error so the booking is unaffected. With
    ``GOOGLE_CALENDAR_INVITE_FAMILY`` it invites the parent (sendUpdates='all')
    and, if the service account can't add attendees, retries once without them
    so the event still lands.
    """
    service = _get_service()
    if service is None:
        return ''

    calendar_id = _calendar_id()
    if invite_family():
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
            sendUpdates='none',
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
            calendarId=_calendar_id(),
            eventId=booking.google_event_id,
            body=_event_body(booking),
            sendUpdates=_send_updates(),
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
            calendarId=_calendar_id(),
            eventId=event_id,
            sendUpdates=_send_updates(),
        ).execute()
        return True
    except Exception as exc:
        # If the event is already gone, consider the cancellation done.
        status_code = getattr(getattr(exc, 'resp', None), 'status', None)
        if status_code in (404, 410):
            return True
        logger.error('Calendar event deletion failed (%s): %s', event_id, exc)
        return False


def check_access():
    """``(ok, message)``: can the service account write to the calendar?

    Reads the calendar's entry in the service account's OWN calendar list (and
    adds it there when missing, which changes nothing in the school's calendar)
    to learn its access role. Never writes an event. For ``sync_calendar --check``.
    """
    problems = diagnose()
    if problems:
        return False, ' '.join(problems)
    service = _get_service()
    if service is None:
        return False, 'No se pudo crear el cliente de Google Calendar (revise el registro del servidor).'
    share = (f'Compártalo con {service_account_email()} con el permiso «Hacer cambios en los eventos» '
             '(Google Calendar, Configuración del calendario, Compartir con personas específicas).')
    calendar_id = _calendar_id()
    try:
        try:
            entry = service.calendarList().get(calendarId=calendar_id).execute()
        except Exception as exc:  # 404: not in the service account's own list yet
            if getattr(getattr(exc, 'resp', None), 'status', None) != 404:
                raise
            entry = service.calendarList().insert(body={'id': calendar_id}).execute()
    except Exception as exc:
        status_code = getattr(getattr(exc, 'resp', None), 'status', None)
        if status_code in (403, 404):
            return False, f'La cuenta de servicio no tiene acceso a ese calendario. {share}'
        logger.warning('Calendar access check failed: %s', exc)
        return False, f'Google no respondió a la revisión del calendario ({type(exc).__name__}). Intente de nuevo.'
    name = entry.get('summary') or 'sin nombre'
    if entry.get('accessRole') in ('owner', 'writer'):
        return True, f'Conexión correcta: la cuenta de servicio puede crear eventos en el calendario «{name}».'
    return False, f'La cuenta de servicio solo puede ver el calendario «{name}». {share}'


# ── Booking-lifecycle helpers (keep views/commands tidy) ──────────────────────

def sync_booking_created(booking):
    """Create the calendar event for a freshly confirmed booking and store its id.

    No-op if calendar is unconfigured or the booking already has an event. Never
    raises; on failure the empty ``google_event_id`` flags it for ``sync_calendar``.
    """
    if booking.google_event_id:
        return ''
    if not is_configured():
        _warn_if_half_configured()
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
