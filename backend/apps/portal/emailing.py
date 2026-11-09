"""
portal/emailing.py — the school's email design system (owner, 2026-11-08).

Every email the portal sends is built from one structure, ``EmailContent``,
and rendered twice from it: a branded HTML part (``templates/email/base.html``)
and a plain-text part with the same content in the same order. A caller
describes *what* to say; the design lives here, once:

    category  ·  title  ·  intro
    highlight (one big figure, e.g. the new balance)
    details card (label / value rows: Alumno, Monto, Fecha…)
    list (e.g. the documents still missing)
    paragraphs
    button  +  "¿El botón no funciona?" link
    note (security or help, set apart)
    footer: the school, how to reach it, why this email arrived, and, for
            family notices, where to change them

Callers that still pass plain ``message`` text get the same design through
``content_from_text`` (paragraphs on blank lines), so no email is left on the
old template.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# Tone of the category chip and the highlight. Colors are the brand's, picked
# for 4.5:1 text contrast on their tint.
TONES: dict[str, dict[str, str]] = {
    'brand':   {'fg': '#401A8E', 'bg': '#F1ECFA'},
    'success': {'fg': '#2F6B1A', 'bg': '#EAF5E4'},
    'warning': {'fg': '#8A4B00', 'bg': '#FFF3DC'},
    'danger':  {'fg': '#B0123E', 'bg': '#FDE8EE'},
    'neutral': {'fg': '#4A4560', 'bg': '#F1EFF5'},
}

MONTHS = ('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
          'septiembre', 'octubre', 'noviembre', 'diciembre')


@dataclass
class EmailContent:
    """What an email says. Only ``title`` is required; empty parts are not rendered."""

    title: str
    intro: str = ''
    category: str = ''
    tone: str = 'brand'
    # Inbox preview line. Defaults to the intro, so the preview never shows "Colegio Interlaken…".
    preheader: str = ''
    highlight: tuple[str, str] | None = None
    details: list[tuple[str, str]] = field(default_factory=list)
    list_title: str = ''
    items: list[str] = field(default_factory=list)
    paragraphs: list[str] = field(default_factory=list)
    cta_label: str = ''
    cta_url: str = ''
    # Long or tokenized links are hard to tap and look suspicious when shown in
    # the body: they go under the button, small, for the case it does not work.
    link_fallback: bool = True
    note: str = ''
    note_tone: str = 'neutral'
    signoff: str = ''
    reason: str = ''
    # Family notices link to the preferences page; staff and one-off emails do not.
    manage_prefs: bool = False

    def tone_colors(self) -> dict[str, str]:
        return TONES.get(self.tone, TONES['brand'])

    def note_colors(self) -> dict[str, str]:
        return TONES.get(self.note_tone, TONES['neutral'])


def content_from_text(subject: str, message: str, *, cta_url: str = '', cta_label: str = '') -> EmailContent:
    """Plain ``message`` text (paragraphs on blank lines) in the new design.

    The closing "Colegio Interlaken" signature some callers still append is
    dropped: the footer already says who wrote.
    """
    paragraphs = [p.strip() for p in (message or '').split('\n\n') if p.strip()]
    while paragraphs and paragraphs[-1].splitlines()[0].strip() in ('Colegio Interlaken', 'Equipo Interlaken'):
        paragraphs.pop()
    intro = paragraphs.pop(0) if paragraphs else ''
    return EmailContent(title=subject, intro=intro, paragraphs=paragraphs,
                        cta_url=cta_url, cta_label=cta_label or ('Abrir el portal' if cta_url else ''))


# ── formatting helpers shared by the callers ──────────────────────────────
def money(value) -> str:
    """$1,234.50 (es-MX)."""
    try:
        amount = Decimal(str(value or 0))
    except Exception:  # pragma: no cover - defensive
        return str(value)
    sign = '-' if amount < 0 else ''
    return f'{sign}${abs(amount):,.2f}'


def long_date(value: date | datetime | None, *, with_time: bool = False) -> str:
    """«11 de noviembre de 2026» (and «, 21:46» in school time when asked)."""
    if value is None:
        return ''
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            value = timezone.localtime(value)
        text = f'{value.day} de {MONTHS[value.month - 1]} de {value.year}'
        return f'{text}, {value:%H:%M}' if with_time else text
    return f'{value.day} de {MONTHS[value.month - 1]} de {value.year}'


def first_name_initial(full_name: str) -> str:
    """«Carla Ramos Terrazas» → «Carla R.»: enough for a parent to recognize, little to expose."""
    parts = [p for p in (full_name or '').split() if p]
    if not parts:
        return ''
    if len(parts) == 1:
        return parts[0]
    return f'{parts[0]} {parts[1][0]}.'


def portal_url(path: str = '/portal') -> str:
    return f"{(getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')}{path}"


def school_contact() -> dict[str, str]:
    """Phone, address and hours from Ajustes (admin-editable), with the site's defaults."""
    data = {
        'name': 'Colegio Interlaken',
        'phone': '(55) 5379-1188',
        'address': 'Av. de los Reyes 67, Residencial el Dorado, Tlalnepantla, Estado de México',
        'hours': 'Lunes a viernes, 7:30 a 15:00',
        'email': getattr(settings, 'CONTACT_EMAIL', '') or 'info@interlaken.com.mx',
    }
    try:
        from apps.content.models import SiteSettings
        site = SiteSettings.load()
        for key, attr in (('phone', 'phone_display'), ('address', 'address'),
                          ('hours', 'office_hours'), ('email', 'contact_email')):
            value = (getattr(site, attr, '') or '').strip()
            if value:
                data[key] = value
    except Exception as e:  # pragma: no cover - the footer must never block a send
        logger.debug('school_contact: using defaults (%s)', e)
    return data


def logo_url() -> str:
    return portal_url('/assets/email/logo.png')


# ── notifications (portal.services.notify and the comunicados dispatcher) ──
# notif_type → (category chip, tone, button, portal page)
NOTIFICATION_STYLE: dict[str, tuple[str, str, str, str]] = {
    'cafeteria': ('Cafetería', 'brand', 'Ver movimientos', '/portal/cafeteria'),
    'payment': ('Pagos', 'brand', 'Ver mis pagos', '/portal/pagos'),
    'warning': ('Aviso importante', 'warning', 'Abrir el portal', '/portal'),
    'info': ('Aviso del colegio', 'brand', 'Ver en el portal', '/portal/notificaciones'),
}
STAFF_ROLES = ('admin', 'staff')


def notification_content(*, user, notif_type: str, title: str, message: str, details=None,
                         highlight=None, tone: str | None = None, url: str | None = None,
                         cta_label: str | None = None, comunicado: bool = False,
                         intro: str | None = None) -> EmailContent:
    """The email for an in-app notification: same title and text, plus category, details and the way back.

    Families get a button to the page that shows it and a link to change their
    avisos; staff get the console instead. ``intro`` replaces the in-app text as
    the email's first sentence when the card already carries its figures.
    """
    category, default_tone, label, path = NOTIFICATION_STYLE.get(notif_type, NOTIFICATION_STYLE['info'])
    staff = getattr(user, 'role', '') in STAFF_ROLES
    if comunicado:
        category, label = 'Comunicado', 'Ver comunicado'
    if staff and not url:
        label, path = 'Abrir la consola', '/admin'
    return EmailContent(
        title=title,
        intro=intro or message,
        category=category,
        tone=tone or default_tone,
        highlight=highlight,
        details=list(details or []),
        cta_label=cta_label or label,
        cta_url=portal_url(url or path),
        link_fallback=False,
        manage_prefs=not staff,
        reason=('Aviso interno de la consola del Colegio Interlaken.' if staff else
                'Recibe este aviso porque tiene activados los avisos por correo en el Portal de Familias.'),
    )


# ── rendering ─────────────────────────────────────────────────────────────
def render_html(subject: str, content: EmailContent, *, reply_to: str = '') -> str:
    """The branded HTML part. A template error is logged and returns '' (text-only send)."""
    from django.template.loader import render_to_string

    try:
        return render_to_string('email/base.html', {
            'subject': subject,
            'c': content,
            'tone': content.tone_colors(),
            'note_colors': content.note_colors(),
            'preheader': content.preheader or content.intro or content.title,
            'contact': school_contact(),
            'reply_to': reply_to,
            'logo_url': logo_url(),
            'portal_home': portal_url('/portal'),
            'prefs_url': portal_url('/portal/perfil?tab=avisos'),
        })
    except Exception as e:  # pragma: no cover - template errors are logged, not raised
        logger.warning('Email HTML render failed (%r): %s', subject, e)
        return ''


def render_text(content: EmailContent, *, reply_to: str = '') -> str:
    """The plain-text part: the same content, in the same order, readable in any client."""
    out: list[str] = []
    if content.category:
        out.append(content.category.upper())
    out.append(content.title)
    out.append('')
    if content.intro:
        out += [content.intro, '']
    if content.highlight:
        out += [f'{content.highlight[0]}: {content.highlight[1]}', '']
    if content.details:
        out += [f'{label}: {value}' for label, value in content.details]
        out.append('')
    if content.items:
        if content.list_title:
            out.append(content.list_title)
        out += [f'- {item}' for item in content.items]
        out.append('')
    for p in content.paragraphs:
        out += [p, '']
    if content.cta_url:
        out += [f'{content.cta_label or "Abrir"}:', content.cta_url, '']
    if content.note:
        out += [content.note, '']
    if content.signoff:
        out += [content.signoff, '']
    contact = school_contact()
    out.append('--')
    out.append(contact['name'])
    out.append(contact['address'])
    out.append(f"Tel. {contact['phone']} · {contact['email']}")
    if reply_to:
        out.append(f'Si responde a este correo, su mensaje llega a {reply_to}.')
    if content.reason:
        out.append(content.reason)
    if content.manage_prefs:
        out.append(f"Cambiar qué avisos recibe: {portal_url('/portal/perfil?tab=avisos')}")
    return '\n'.join(out).strip() + '\n'
