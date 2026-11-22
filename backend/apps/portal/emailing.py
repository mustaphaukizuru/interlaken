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

Two families (UI/UX Phase 9, docs/UIUX-REFINEMENT-PROMPT.md §14):

* ``transactional`` (default): access, cafetería, admissions, visits, staff
  alerts and emergencies. One message, one action, no promotional blocks.
* ``notice``: school comunicados. May add a hero image, up to three content
  cards and a stat strip. Those blocks never render in a transactional email,
  whatever the caller passes.

Colours are the site's tokens (frontend/src/index.css ``:root``); the parity
test (apps/portal/test_email_tokens.py) fails when one drifts. ``EMAIL_ONLY``
lists the few values that exist only in email, with the reason.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# Tone of the category chip, the highlight and the note: the site's status
# pairs (index.css --info/--success/--warning/--danger/--neutral -fg/-bg), each
# fg on its own bg at 4.5:1 or more. Keys are frozen: callers pass them.
TONES: dict[str, dict[str, str]] = {
    'brand':   {'fg': '#401A8E', 'bg': '#EDE8F7'},   # --info-fg / --info-bg (purple)
    'success': {'fg': '#316F1C', 'bg': '#EEF7E9'},   # --success-fg / --success-bg
    'warning': {'fg': '#B45309', 'bg': '#FDF3E4'},   # --warning-fg / --warning-bg
    'danger':  {'fg': '#C51D1A', 'bg': '#FDECEC'},   # --danger-fg / --danger-bg
    'neutral': {'fg': '#6E6885', 'bg': '#F5F4FA'},   # --neutral-fg / --neutral-bg
}

# The rest of the palette base.html uses, by role (all tokens unless listed in
# EMAIL_ONLY). The template repeats them as literals, because email clients
# ignore CSS variables; the parity test reads both.
PALETTE: dict[str, str] = {
    'page': '#F5F4FA',           # --cream: the page around the white panel
    'panel': '#FFFFFF',          # white panel (EMAIL_ONLY)
    'tint': '#F5F4FA',           # --cream: details and card blocks inside the panel
    'ink': '#1A1130',            # --text-main: headings and values
    'body': '#3D3852',           # paragraphs (EMAIL_ONLY)
    'muted': '#6E6885',          # --text-muted: labels and fine print
    'link': '#401A8E',           # --purple
    'button': '#401A8E',         # --purple: the one primary button (D18)
    'button_label': '#FFFFFF',   # white label, 11.96:1 on the button
    'bullet': '#47A028',         # --green: list bullets (decorative)
    'stripe_green': '#47A028',   # --green
    'stripe_purple': '#401A8E',  # --purple
    'stripe_pink': '#E01A4E',    # --pink
}

# Values that exist only in email, with why. Everything else must be a token.
EMAIL_ONLY: dict[str, str] = {
    '#3D3852': 'Paragraph text: a softer ink than --text-main for long reading '
               '(about 11:1 on white), kept from the 2026-11-08 design.',
    '#FFFFFF': 'White: the panel and the button label.',
}

# Inbox preview line (what Gmail and Apple Mail show after the subject).
PREHEADER_MAX = 90
# Notice-only blocks (family «notice»): at most this many cards and stats.
MAX_CARDS = 3
MAX_STATS = 3

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
    # «transactional» (default) or «notice» (comunicados). Only a notice may
    # carry the blocks below; a transactional email ignores them.
    family: str = 'transactional'
    hero_image_url: str = ''
    hero_image_alt: str = ''
    # Up to MAX_CARDS dicts: {'title', 'text', 'link', optional 'link_label'}.
    cards: list[dict] = field(default_factory=list)
    # Up to MAX_STATS (label, value) pairs shown side by side.
    stats: list[tuple[str, str]] = field(default_factory=list)

    def tone_colors(self) -> dict[str, str]:
        return TONES.get(self.tone, TONES['brand'])

    def note_colors(self) -> dict[str, str]:
        return TONES.get(self.note_tone, TONES['neutral'])

    @property
    def is_notice(self) -> bool:
        return self.family == 'notice'

    def notice_blocks(self) -> dict:
        """The notice-only blocks to render: always empty for a transactional email."""
        if not self.is_notice:
            return {'hero': None, 'cards': [], 'stats': [], 'stat_width': ''}
        hero = None
        if self.hero_image_url:
            hero = {'url': self.hero_image_url, 'alt': self.hero_image_alt or self.title}
        cards = [c for c in (self.cards or []) if (c or {}).get('title')][:MAX_CARDS]
        stats = [st for st in (self.stats or []) if st and st[0]][:MAX_STATS]
        return {'hero': hero, 'cards': cards, 'stats': stats,
                'stat_width': f'{100 // len(stats)}%' if stats else ''}

    def preheader_text(self) -> str:
        """The inbox preview: the preheader, else the intro, else the title, cut
        to PREHEADER_MAX characters on a word boundary."""
        return clip(self.preheader or self.intro or self.title, PREHEADER_MAX)


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
def clip(text: str, limit: int) -> str:
    """``text`` on one line, at most ``limit`` characters, cut on a word boundary with «…»."""
    text = ' '.join((text or '').split())
    if len(text) <= limit:
        return text
    cut = text[:limit - 1]
    if ' ' in cut and text[limit - 1] != ' ':
        cut = cut[:cut.rindex(' ')]
    return cut.rstrip(' ,;:.') + '…'


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


def name_initial(first: str, last: str = '') -> str:
    """«Ana María» + «Pérez López» → «Ana P.»: the first given name and the
    first surname's initial (D13). With one part missing, what is there."""
    given = (first or '').split()
    surnames = (last or '').split()
    if not given:
        return first_name_initial(last)
    if not surnames:
        return first_name_initial(first)
    return f'{given[0]} {surnames[0][0]}.'


def person_initial(user) -> str:
    """A student as emails name them (D13): «Carla R.»."""
    if user is None:
        return ''
    first = getattr(user, 'first_name', '') or ''
    last = getattr(user, 'last_name', '') or ''
    if first or last:
        return name_initial(first, last)
    return first_name_initial(getattr(user, 'full_name', '') or '')


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


# Images need an absolute URL in an email: when FRONTEND_URL is empty (a bare
# dev shell) the logo still loads from the public site.
PUBLIC_SITE_URL = 'https://interlaken.edu.mx'


def logo_url() -> str:
    base = (getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/') or PUBLIC_SITE_URL
    return f'{base}/assets/email/logo.png'


# ── notifications (portal.services.notify and the comunicados dispatcher) ──
# notif_type → (category chip, tone, button, portal page)
NOTIFICATION_STYLE: dict[str, tuple[str, str, str, str]] = {
    'cafeteria': ('Cafetería', 'brand', 'Ver movimientos', '/portal/cafeteria'),
    'payment': ('Pagos', 'brand', 'Ver mis pagos', '/portal/pagos'),
    'warning': ('Aviso importante', 'warning', 'Abrir el portal', '/portal'),
    'info': ('Aviso del colegio', 'brand', 'Ver en el portal', '/portal/notificaciones'),
}
STAFF_ROLES = ('admin', 'staff')
# Mirrors NotificationPreference.URGENT_TYPES: sent whatever the family's toggles.
URGENT_TYPES = ('warning',)


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
    # An emergency broadcast is a comunicado of type «warning»: it keeps its
    # «Aviso importante» chip and the transactional layout (spec §14).
    emergency = comunicado and notif_type in URGENT_TYPES
    if comunicado:
        label = 'Ver aviso' if emergency else 'Ver comunicado'
        if not emergency:
            category = 'Comunicado'
    if staff and not url:
        label, path = 'Abrir la consola', '/admin'
    # Senders email a family only when its Avisos tab has email on, except for
    # urgent alerts, which go to everyone: the footer says which one this is.
    if staff:
        reason = 'Aviso interno de la consola del Colegio Interlaken.'
    elif notif_type in URGENT_TYPES:
        reason = ('Recibe este aviso porque es una alerta urgente: el colegio las envía a todas '
                  'las familias, aunque tengan los avisos por correo desactivados.')
    else:
        reason = 'Recibe este aviso porque tiene activados los avisos por correo en el Portal de Familias.'
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
        reason=reason,
        family='notice' if comunicado and not emergency else 'transactional',
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
            'notice': content.notice_blocks(),
            'preheader': content.preheader_text(),
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
    notice = content.notice_blocks()
    if notice['hero']:
        out += [f"[Imagen: {notice['hero']['alt']}]", '']
    if content.intro:
        out += [content.intro, '']
    if notice['stats']:
        out += [f'{label}: {value}' for label, value in notice['stats']]
        out.append('')
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
    for card in notice['cards']:
        out.append(card['title'])
        if card.get('text'):
            out.append(card['text'])
        if card.get('link'):
            out.append(f"{card.get('link_label') or 'Ver más'}: {card['link']}")
        out.append('')
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
