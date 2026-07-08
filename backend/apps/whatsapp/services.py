"""
whatsapp/services.py — WhatsApp Business (Cloud API) integration for booking.

Two responsibilities, kept fail-soft so a webhook call never 500s:

  1. **Inbound verification** — ``verify_signature`` constant-time checks Meta's
     ``X-Hub-Signature-256`` header against ``WHATSAPP_APP_SECRET`` (fails closed:
     no secret or no header → rejected).
  2. **Outbound Cloud API** — ``send_text`` / ``send_slot_list`` post to the Graph
     API. When the Cloud API creds (``WHATSAPP_TOKEN`` / ``WHATSAPP_PHONE_ID``)
     are unset, sends are logged no-ops so Tier 2 degrades gracefully.

The conversational flow (``handle_message``) is deliberately stateless: an inbound
text lists the next open slots as an interactive list; tapping a row (reply id
``book_slot:<id>``) creates a ``Booking(source=whatsapp)`` — capacity-safe, with
Google Calendar sync (fail-soft, Prompt 13) — and confirms in-channel. No email is
sent (WhatsApp bookings confirm over WhatsApp). See BOOKING_CALENDAR_SPEC §5.
"""
import hashlib
import hmac
import logging

import requests
from django.conf import settings
from django.utils import timezone

from apps.bookings.models import AvailabilitySlot, Booking
from apps.bookings.services import SlotUnavailable, create_booking

logger = logging.getLogger(__name__)

# Prefix used to round-trip a slot id through a WhatsApp interactive reply.
SLOT_REPLY_PREFIX = 'book_slot:'
# WhatsApp interactive lists allow at most 10 rows; keep headroom.
MAX_SLOT_ROWS = 9
# Cloud API field length limits (truncate to stay within them).
_ROW_TITLE_MAX = 24
_ROW_DESC_MAX = 72

_WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
           'jul', 'ago', 'sep', 'oct', 'nov', 'dic']


# ── Inbound signature verification ────────────────────────────────────────────

def verify_signature(request) -> bool:
    """Constant-time verify Meta's ``X-Hub-Signature-256`` over the raw body.

    Fails closed: returns False when ``WHATSAPP_APP_SECRET`` is unset or the
    header is missing/malformed, so an unsigned or forged POST is always rejected.
    """
    secret = getattr(settings, 'WHATSAPP_APP_SECRET', '')
    header = request.headers.get('X-Hub-Signature-256', '')
    if not secret or not header.startswith('sha256='):
        return False
    provided = header.split('=', 1)[1]
    expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


def verify_handshake(params):
    """Return the ``hub.challenge`` string when Meta's GET handshake is valid, else None.

    Meta calls ``GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`` when
    you register the webhook; echoing the challenge (200 text/plain) completes it.
    """
    verify_token = getattr(settings, 'WHATSAPP_VERIFY_TOKEN', '')
    mode = params.get('hub.mode')
    token = params.get('hub.verify_token')
    challenge = params.get('hub.challenge')
    if mode == 'subscribe' and verify_token and token == verify_token:
        return challenge
    return None


# ── Outbound Cloud API ────────────────────────────────────────────────────────

def _is_send_configured():
    return bool(getattr(settings, 'WHATSAPP_TOKEN', '')
                and getattr(settings, 'WHATSAPP_PHONE_ID', ''))


def _post(payload):
    """POST a message payload to the Graph API. Fail-soft: never raises."""
    if not _is_send_configured():
        logger.info('WhatsApp send skipped (Cloud API not configured): %s',
                    payload.get('type'))
        return False
    version = getattr(settings, 'WHATSAPP_API_VERSION', 'v19.0')
    url = f'https://graph.facebook.com/{version}/{settings.WHATSAPP_PHONE_ID}/messages'
    headers = {'Authorization': f'Bearer {settings.WHATSAPP_TOKEN}'}
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        if resp.status_code >= 400:
            logger.warning('WhatsApp send failed (%s): %s', resp.status_code, resp.text[:300])
            return False
        return True
    except requests.RequestException as exc:
        logger.warning('WhatsApp send error: %s', exc)
        return False


def send_text(to, body):
    """Send a plain text WhatsApp message to ``to`` (a wa_id). Fail-soft."""
    return _post({
        'messaging_product': 'whatsapp',
        'to': to,
        'type': 'text',
        'text': {'body': body},
    })


def send_slot_list(to, slots):
    """Send an interactive list of open slots; each row id encodes the slot. Fail-soft."""
    rows = []
    for slot in slots[:MAX_SLOT_ROWS]:
        rows.append({
            'id': f'{SLOT_REPLY_PREFIX}{slot.id}',
            'title': _slot_title(slot)[:_ROW_TITLE_MAX],
            'description': _slot_description(slot)[:_ROW_DESC_MAX],
        })
    payload = {
        'messaging_product': 'whatsapp',
        'to': to,
        'type': 'interactive',
        'interactive': {
            'type': 'list',
            'header': {'type': 'text', 'text': 'Colegio Interlaken'},
            'body': {'text': 'Estos son los próximos horarios disponibles para visitar el colegio. '
                             'Elija uno para reservar su lugar.'},
            'footer': {'text': 'Reserva tu visita'},
            'action': {
                'button': 'Ver horarios',
                'sections': [{'title': 'Próximas visitas', 'rows': rows}],
            },
        },
    }
    return _post(payload)


# ── Slot formatting ───────────────────────────────────────────────────────────

def _fmt_date(d):
    return f'{_WEEKDAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]}'


def _slot_title(slot):
    return f'{_fmt_date(slot.date)}, {slot.start_time:%H:%M}'


def _slot_description(slot):
    label = slot.get_visit_type_display()
    return f'{label} · {slot.location or "Campus Interlaken"}'


def next_open_slots(limit=MAX_SLOT_ROWS):
    """Active, non-past, non-full slots (individual + open class), soonest first."""
    today = timezone.now().date()
    qs = AvailabilitySlot.objects.filter(is_active=True, date__gte=today).order_by('date', 'start_time')
    return [s for s in qs if not s.is_full][:limit]


# ── Conversational flow ───────────────────────────────────────────────────────

def _extract_message(payload):
    """Pull the first (message, contact) pair out of a Cloud API webhook payload.

    Returns ``(message_dict, contact_dict)`` or ``(None, None)`` for status
    callbacks / anything without a user message. Never raises on odd shapes.
    """
    try:
        value = payload['entry'][0]['changes'][0]['value']
    except (KeyError, IndexError, TypeError):
        return None, None
    messages = value.get('messages')
    if not messages:
        return None, None  # delivery/read status callbacks carry no 'messages'
    contacts = value.get('contacts') or [{}]
    return messages[0], contacts[0]


def handle_webhook(payload):
    """Process an inbound webhook payload. Returns a short status string (for logs)."""
    message, contact = _extract_message(payload)
    if not message:
        return 'ignored'
    return handle_message(message, contact)


def handle_message(message, contact):
    """Route a single inbound message to a booking reply. Fail-soft."""
    sender = message.get('from')
    if not sender:
        return 'no-sender'
    profile_name = (contact.get('profile') or {}).get('name', '') if contact else ''

    msg_type = message.get('type')
    if msg_type == 'interactive':
        reply_id = _interactive_reply_id(message)
        if reply_id and reply_id.startswith(SLOT_REPLY_PREFIX):
            return _book_slot(sender, profile_name, reply_id[len(SLOT_REPLY_PREFIX):])
        # Unknown interactive reply → fall through to listing slots again.

    # Any text (or unrecognised interactive tap) → offer the next open slots.
    return _offer_slots(sender)


def _interactive_reply_id(message):
    interactive = message.get('interactive') or {}
    reply = interactive.get('list_reply') or interactive.get('button_reply') or {}
    return reply.get('id', '')


def _offer_slots(sender):
    slots = next_open_slots()
    if not slots:
        send_text(sender,
                  '¡Hola! Por el momento no tenemos horarios de visita publicados. '
                  'Escríbanos y con gusto le agendamos una fecha. — Colegio Interlaken')
        return 'no-slots'
    send_slot_list(sender, slots)
    return 'offered'


def _book_slot(sender, profile_name, slot_id_raw):
    try:
        slot_id = int(slot_id_raw)
    except (TypeError, ValueError):
        send_text(sender, 'No reconocimos ese horario. Escríbanos "hola" para ver las fechas disponibles.')
        return 'bad-slot-id'

    parent_name = profile_name or 'Familia (WhatsApp)'
    try:
        booking = create_booking(
            slot_id=slot_id,
            parent_name=parent_name,
            parent_email='',           # WhatsApp bookings confirm in-channel, not by email
            parent_phone=sender,
            num_attendees=1,
            source=Booking.Source.WHATSAPP,
            notify_email=False,
        )
    except SlotUnavailable as exc:
        send_text(sender, f'{exc} Le muestro otras fechas disponibles.')
        _offer_slots(sender)
        return 'slot-unavailable'

    slot = booking.slot
    send_text(
        sender,
        '✅ ¡Su visita quedó reservada!\n\n'
        f'📅 {_fmt_date(slot.date)}\n'
        f'🕒 {slot.start_time:%H:%M} - {slot.end_time:%H:%M}\n'
        f'📍 {slot.location or "Campus Interlaken"}\n\n'
        'Si necesita cancelar o reprogramar, respóndanos por este medio. '
        '¡Le esperamos! — Colegio Interlaken',
    )
    return 'booked'
