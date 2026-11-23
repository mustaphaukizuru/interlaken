"""
content/publish_checks.py: «Revisión antes de publicar» (2026-11-21).

One engine for everything a CMS page goes through on its way to the public
site, so the editor, the publish endpoint, the scheduled publish, the bulk
publish, the «Contenido» chips and the audit of live pages never disagree.

    review(page) -> {ok, errors, warnings, suggestions, issues, changes, baseline}

``errors`` stop a publication (409 ``publish_blocked``); ``warnings`` need an
explicit «Entiendo las advertencias» (409 ``publish_warnings`` until the
request says ``acknowledge_warnings: true``); ``suggestions`` (the SEO advice
of checks.py, a repeated section, an http link) only inform. ``changes`` is
«Qué cambia»: the draft against what the site shows today (the published
version, else the page's design), field by field, as visitors read it
(tokens resolved).

It runs the structural checks (checks.run_checks: required fields, images,
broken links, SEO) and adds the content rules born from a real incident (the
«costos» draft of 2026-11-21: «Precios 2026{{anio}}», pending labels holding
only tokens, a published button to the private /pre-registro):

ERROR    private_link          a link on a public page to a private or staff route
                               (/pre-registro, /inscripcion*, /confirmar-correo,
                               /admin*, /staff*), also as a full URL of this site
ERROR    unknown_token         {{x}} the site does not know, or loose braces:
                               visitors would read it as is
WARNING  token_glued           a token glued to letters, digits or another token
                               («2026{{anio}}» prints «20262026»)
WARNING  token_only_label      a short label, badge or title holding only tokens
WARNING  empty_required        a text the design fills that the draft emptied
WARNING  restored_old_default  a value the designs retired (migration 0033: the
                               old ficha texts and buttons)
WARNING  large_change          sections removed or hidden, or many fields at once

Every issue: level, code, key (stable: code, section id, field), message (the
whole sentence), block_index, block_id, block_label, field (the editor field,
``items.2.title``; ``seo.title`` for SEO), field_label, field_message (short,
shown under the field), value (the field today), preview (what visitors
read), fix ({kind, label, value, preview}, the field's new value) or None,
acknowledge (a warning that needs «Entiendo las advertencias»).

Page.publish() itself stays ungated: migrations and commands publish as before.
"""
from __future__ import annotations

import copy
import datetime as dt
import difflib
import html
import importlib
import json
import logging
import re
import unicodedata
from functools import lru_cache
from typing import NamedTuple

from django.conf import settings
from django.utils import timezone

from .checks import CheckContext, run_checks
from .pages import (
    LABEL_SEP,
    Page,
    block_label,
    confirmed,
    field_label,
    field_path,
    located_error,
    manifest,
    where,
)

logger = logging.getLogger(__name__)

# ── tokens: frontend/src/cms/runtime.tsx (TEXT_TOKENS, applyTokens) ─────────
TOKENS = ('ciclo', 'anios', 'fundacion', 'anio', 'telefono', 'correo', 'direccion', 'horario', 'whatsapp')
_NAMES = '|'.join(TOKENS)
TOKEN_RE = re.compile(r'\{\{\s*(' + _NAMES + r')\s*\}\}')
ANY_TOKEN_RE = re.compile(r'\{\{([^{}]*)\}\}')
TOKEN_ONLY_RE = re.compile(r'^\s*(?:\{\{\s*(?:' + _NAMES + r')\s*\}\}\s*)+$')
# What people type for a token they half remember.
TOKEN_ALIASES = {
    'ano': 'anio', 'anos': 'anios', 'year': 'anio', 'years': 'anios', 'ciclo_escolar': 'ciclo', 'cicloescolar': 'ciclo',
    'email': 'correo', 'mail': 'correo', 'tel': 'telefono', 'phone': 'telefono', 'wa': 'whatsapp',
}
FOUNDED_YEAR = 1981   # frontend/src/lib/siteMeta.ts FOUNDED_YEAR

# ── private routes ──────────────────────────────────────────────────────────
# Pages a family only reaches by sign-in or by the personal link the school
# sends; the staff consoles. A public page never links to them.
FICHA_PATHS = ('/pre-registro', '/inscripcion')
PRIVATE_PATHS = ('/pre-registro', '/inscripcion', '/confirmar-correo', '/admin', '/staff')
# Pages that are private themselves: their links among private pages are fine.
PRIVATE_PAGE_SLUGS = frozenset({'pre-registro', 'inscripcion', 'inscripcion-documentos', 'confirmar-correo'})
SITE_HOSTS = ('interlaken.edu.mx', 'www.interlaken.edu.mx')
VISIT = {'label': 'Agendar visita', 'href': '/agendar-visita'}
MSG_FICHA = ('La ficha de inscripción es personal: el colegio envía el enlace a cada familia admitida. '
             'Use «Agendar visita» (/agendar-visita) o «Admisiones» (/admisiones).')
MSG_PERSONAL = ('Esta página solo se abre con el enlace personal que envía el colegio. '
                'Use «Agendar visita» (/agendar-visita) u otra página pública.')
MSG_STAFF = ('{path} es la consola del personal: las familias no pueden entrar. '
             'Use «Agendar visita» (/agendar-visita) u otra página pública.')

# ── rules ───────────────────────────────────────────────────────────────────
TEXT_KINDS = frozenset({'text', 'textarea', 'richtext', 'link_label', 'caption', 'cell', 'other'})
LABEL_KINDS = frozenset({'text', 'link_label'})
# A short field that may hold a token alone (a stat's value, a year, an e-mail).
TOKEN_FIELD_RE = re.compile(r'(year|value|anio|email|correo|phone|tel|whatsapp|number|count|stat|fecha|date)$', re.I)
LARGE_CHANGE_FIELDS = 15
# Warnings that are almost always a slip: a scheduled publication stops on them too.
SCHEDULE_BLOCKING = frozenset({'token_glued', 'token_only_label', 'empty_required', 'restored_old_default'})
# Advice (SEO lengths, a repeated section type, an http link): shown as
# «Sugerencias», never asks for «Entiendo las advertencias».
SUGGESTIONS = frozenset({'seo_description', 'seo_long', 'seo_title', 'seed_seo', 'missing_og_image', 'duplicate', 'insecure_link'})
MAX_CHANGES = 150
SHOW_MAX = 280

# Short names for the «Contenido» chips («Bloqueado: enlace privado»).
CODE_LABELS = {
    'private_link': 'enlace privado', 'unknown_token': 'dato desconocido', 'broken_link': 'enlace roto',
    'relative_link': 'enlace incompleto', 'required': 'falta un dato', 'empty_text': 'texto vacío',
    'empty_gallery': 'galería sin fotos', 'empty': 'página sin secciones', 'locked_hidden': 'sección obligatoria oculta',
    'missing_image': 'imagen borrada', 'missing_alt': 'foto sin descripción', 'token_glued': 'dato pegado',
    'token_only_label': 'etiqueta solo con datos', 'empty_required': 'texto vacío', 'restored_old_default': 'texto antiguo',
    'large_change': 'cambio grande', 'duplicate': 'sección repetida', 'insecure_link': 'enlace sin https',
    'seo_description': 'SEO', 'seo_long': 'SEO', 'seo_title': 'SEO', 'seed_seo': 'SEO', 'missing_og_image': 'SEO',
}

_MISSING = object()
_TAG_RE = re.compile(r'<[^>]+>')
_ANCHOR_RE = re.compile(r'<a\b[^>]*?\bhref=["\']([^"\']*)["\'][^>]*>(.*?)</a>', re.I | re.S)
_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
_MARK_LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)\s]+)\)')   # links.ts MARK_LINK_RE
_LETTERS = r'A-Za-zÁÉÍÓÚÜÑáéíóúüñ'
_STRAY_OPEN_RE = re.compile(r'\{\{\s*([' + _LETTERS + r'_ ]+?)\s*\}(?!\})')
_STRAY_CLOSE_RE = re.compile(r'(?<!\{)\{\s*([' + _LETTERS + r'_ ]+?)\s*\}\}')


# ═══ tokens ══════════════════════════════════════════════════════════════════
def token_values(today: dt.date | None = None) -> dict[str, str]:
    """What each token prints today (runtime.tsx applyTokens; contact data from the site settings)."""
    from .models import SiteSettings
    from .site_years import announced_cycle_start, cycle_label

    s = SiteSettings.load()
    today = today or timezone.localdate()
    year = today.year
    return {
        'ciclo': cycle_label(announced_cycle_start(today, s.admissions_next_from_month or 1)),
        'anios': str(year - FOUNDED_YEAR), 'fundacion': str(FOUNDED_YEAR),
        'anio': str(year), 'telefono': s.phone_display or '', 'correo': s.contact_email or '',
        'direccion': s.address or '', 'horario': s.office_hours or '', 'whatsapp': s.whatsapp_number or '',
    }


def render(text, values: dict[str, str]) -> str:
    """``text`` with its tokens replaced, exactly as the public site prints it (unknown ones stay)."""
    if not isinstance(text, str):
        return ''
    return TOKEN_RE.sub(lambda m: values.get(m.group(1), ''), text) if '{{' in text else text


def _fold(name: str) -> str:
    plain = unicodedata.normalize('NFD', name).encode('ascii', 'ignore').decode()
    return re.sub(r'[\s\-]+', '_', plain.strip().lower()).replace('ñ', 'n')


def suggest_token(name: str) -> str | None:
    """The token someone meant by ``name`` («Ciclo», «año», «telefno»), or None."""
    f = _fold(name)
    if f in TOKENS:
        return f
    if f in TOKEN_ALIASES:
        return TOKEN_ALIASES[f]
    close = difflib.get_close_matches(f.replace('_', ''), TOKENS, n=1, cutoff=0.75)
    return close[0] if close else None


def _plain(kind: str, text: str) -> str:
    """Text as read on the page: no HTML tags (rich text), no ``**`` or ``[texto](enlace)`` marks."""
    if kind == 'richtext' or '<' in text:
        text = html.unescape(_TAG_RE.sub(' ', text))
    text = _MARK_LINK_RE.sub(r'\1', text).replace('**', '')
    return ' '.join(text.split())


def _clip(s: str) -> str:
    return s if len(s) <= SHOW_MAX else s[:SHOW_MAX - 1].rstrip() + '…'


def _in_markup(text: str, pos: int) -> bool:
    """True when ``pos`` sits inside an HTML tag or a ``[texto](enlace)`` target (an address, not text)."""
    lt, gt = text.rfind('<', 0, pos), text.rfind('>', 0, pos)
    if lt > gt:
        return True
    return any(m.start(2) <= pos < m.end(2) for m in _MARK_LINK_RE.finditer(text))


def glued_fix(text: str) -> tuple[str, list[str], bool] | None:
    """(fixed text, tokens removed, spaces added) for tokens glued to letters, digits or another token; None when fine.

    Glued to a digit or to another token, the token is a duplicate («2026{{anio}}», «{{ciclo}}{{anio}}»):
    it goes. Glued to a letter («Ciclo{{ciclo}}»), it was meant to read apart: a space is added.
    """
    spans = [m for m in TOKEN_RE.finditer(text) if not _in_markup(text, m.start())]
    if not spans:
        return None
    remove, space_before, space_after = set(), set(), set()
    for n, m in enumerate(spans):
        before = text[m.start() - 1] if m.start() > 0 else ''
        after = text[m.end()] if m.end() < len(text) else ''
        glued_token = n > 0 and spans[n - 1].end() == m.start()
        if glued_token or before.isdigit() or after.isdigit():
            remove.add(n)
            continue
        if before.isalpha():
            space_before.add(n)
        if after.isalpha():
            space_after.add(n)
    if not (remove or space_before or space_after):
        return None
    out, at, removed = [], 0, []
    for n, m in enumerate(spans):
        start, end = m.span()
        if n in remove:
            removed.append(m.group(0))
            out.append(_before_drop(text, at, start, end))
            at = _after_drop(text, start, end)
            continue
        out.append(text[at:start])
        out.append((' ' if n in space_before else '') + m.group(0) + (' ' if n in space_after else ''))
        at = end
    out.append(text[at:])
    return ''.join(out), list(dict.fromkeys(removed)), bool(space_before or space_after)


def _before_drop(text: str, at: int, start: int, end: int) -> str:
    """The text before a span that goes, without the space that only separated it («Hoy {{x}} cerrado»)."""
    seg = text[at:start]
    if seg.endswith(' ') and (end == len(text) or not text[end].isalnum()):
        seg = seg[:-1]
    return seg


def _after_drop(text: str, start: int, end: int) -> int:
    """Where the text resumes after a span that goes: past one space when the span opened the text («{{x}} Hoy»)."""
    opens = start == 0 or text[start - 1] in '>\n'
    return end + 1 if opens and text[end:end + 1] == ' ' else end


def _drop(text: str, spans: list[tuple[int, int]]) -> str:
    """``text`` without these spans, each taking with it the space that only separated it."""
    out, at = [], 0
    for start, end in sorted(spans):
        if start < at:
            continue
        out.append(_before_drop(text, at, start, end))
        at = _after_drop(text, start, end)
    out.append(text[at:])
    return ''.join(out)


def _token(name: str) -> str:
    return '{{' + name + '}}'


def unknown_tokens(text: str) -> tuple[list[str], str | None]:
    """(what is wrong, text with it repaired or removed) for unknown tokens and loose braces; ([], None) when fine.

    A name close to a real token becomes that token («{{Ciclo}}», «{{año}}»); any other goes. Loose braces
    around a real token are closed («{{anio}»); others leave no fix.
    """
    found: list[str] = []
    drop: list[tuple[int, int]] = []
    for m in ANY_TOKEN_RE.finditer(text):
        name = m.group(1).strip()
        if name in TOKENS:
            continue
        found.append(m.group(0))
        if not suggest_token(name):
            drop.append(m.span())
    fixed = _drop(text, drop) if drop else text

    def mend(m):
        name = m.group(1).strip()
        if name in TOKENS:
            return m.group(0)
        better = suggest_token(name)
        return _token(better) if better else m.group(0)

    fixed = ANY_TOKEN_RE.sub(mend, fixed)
    rest = ANY_TOKEN_RE.sub('', fixed)
    if '{{' in rest or '}}' in rest:
        def close(m):
            better = suggest_token(m.group(1))
            found.append(m.group(0))
            return _token(better) if better else m.group(0)

        fixed = _STRAY_CLOSE_RE.sub(close, _STRAY_OPEN_RE.sub(close, fixed))
        rest = ANY_TOKEN_RE.sub('', fixed)
        if '{{' in rest or '}}' in rest:
            found.append('{{' if '{{' in rest else '}}')
            fixed = None
    return list(dict.fromkeys(found)), (fixed if found else None)


# ═══ private links ═══════════════════════════════════════════════════════════
def _site_hosts() -> set[str]:
    hosts = set(SITE_HOSTS)
    m = re.match(r'^https?://([^/?#]+)', (getattr(settings, 'FRONTEND_URL', '') or '').strip(), re.I)
    if m:
        hosts.add(m.group(1).lower())
    return hosts


def site_path(href) -> str | None:
    """Path of a link to this site («/pre-registro?x=1» or «https://interlaken.edu.mx/pre-registro»), else None."""
    h = str(href or '').strip()
    m = re.match(r'^https?://([^/?#]+)(.*)$', h, re.I)
    if m:
        if m.group(1).lower() not in _site_hosts():
            return None
        h = m.group(2) or '/'
    if not h.startswith('/') or h.startswith('//'):
        return None
    return h.split('?')[0].split('#')[0].rstrip('/') or '/'


def private_target(href) -> str | None:
    """The private route a link goes to («/pre-registro», «/admin»…), or None for a public destination."""
    path = site_path(href)
    if path is None:
        return None
    for p in PRIVATE_PATHS:
        # /inscripcion* covers /inscripcion/documentos and its variants.
        if path == p or path.startswith(p + '/') or (p == '/inscripcion' and path.startswith(p)):
            return p
    return None


def _private_message(target: str) -> str:
    if target in FICHA_PATHS:
        return MSG_FICHA
    if target == '/confirmar-correo':
        return MSG_PERSONAL
    return MSG_STAFF.format(path=target)


def _unlink_private(text: str) -> str:
    """Rich or marked text with its links to private pages taken out (the words stay)."""
    text = _ANCHOR_RE.sub(lambda m: m.group(2) if private_target(m.group(1)) else m.group(0), text)
    return _MARK_LINK_RE.sub(lambda m: m.group(1) if private_target(m.group(2)) else m.group(0), text)


# ═══ props: fields, values, paths ════════════════════════════════════════════
class Leaf(NamedTuple):
    path: str     # data path: 'ctaPrimary.href', 'items.2.title'
    kind: str     # text | textarea | richtext | link_label | href | caption | cell | form | other
    value: object


def _entry(block_type) -> dict:
    return (manifest().get(block_type) if isinstance(block_type, str) else None) or {}


def kinds_of(block_type) -> dict:
    return _entry(block_type).get('kinds') or {}


def defaults_of(block_type) -> dict:
    return _entry(block_type).get('defaults') or {}


def _manifest_key(path: str) -> str:
    key = ''
    for seg in [p for p in (path or '').split('.') if p]:
        key = f'{key}[]' if seg.isdigit() else (f'{key}.{seg}' if key else seg)
    return key


def kind_at(block_type, path: str) -> str | None:
    return kinds_of(block_type).get(_manifest_key(path))


def get_at(obj, path: str):
    for seg in [p for p in (path or '').split('.') if p]:
        if isinstance(obj, list) and seg.isdigit() and int(seg) < len(obj):
            obj = obj[int(seg)]
        elif isinstance(obj, dict):
            obj = obj.get(seg)
        else:
            return None
    return obj


def set_at(obj, path: str, value) -> None:
    parts = [p for p in path.split('.') if p]
    cur = obj
    for seg in parts[:-1]:
        cur = cur[int(seg)] if isinstance(cur, list) else cur.setdefault(seg, {})
    last = parts[-1]
    if isinstance(cur, list):
        cur[int(last)] = value
    else:
        cur[last] = value


def merged(block_type, props) -> dict:
    """Props as the site renders them: the section defaults under what the page sets (registry withDefaults)."""
    return {**defaults_of(block_type), **(props if isinstance(props, dict) else {})}


def leaves(block_type, props) -> list[Leaf]:
    """Every text and link of a block's props, with its kind (manifest ``kinds``; a guess for props it does not know)."""
    kinds = kinds_of(block_type)
    out: list[Leaf] = []

    def walk(value, path, key):
        kind = kinds.get(key) if key else None
        looks_link = isinstance(value, dict) and 'href' in value and set(value) <= {'label', 'href', 'icon', 'external'}
        if kind == 'link' or (kind is None and looks_link):
            if isinstance(value, dict):
                if isinstance(value.get('label'), str):
                    out.append(Leaf(f'{path}.label', 'link_label', value['label']))
                if isinstance(value.get('href'), str):
                    out.append(Leaf(f'{path}.href', 'href', value['href']))
            return
        if kind == 'table':
            if isinstance(value, dict):
                for c in value.get('columns') or []:
                    if isinstance(c, dict) and isinstance(c.get('label'), str):
                        out.append(Leaf(path, 'cell', c['label']))
                for row in value.get('rows') or []:
                    for cell in row if isinstance(row, list) else []:
                        if isinstance(cell, str):
                            out.append(Leaf(path, 'cell', cell))
            return
        if kind == 'images':
            for n, it in enumerate(value if isinstance(value, list) else []):
                if isinstance(it, dict) and isinstance(it.get('caption'), str):
                    out.append(Leaf(f'{path}.{n}.caption', 'caption', it['caption']))
            return
        if kind == 'form':
            if isinstance(value, str):
                out.append(Leaf(path, 'form', value))
            return
        if kind in ('image', 'icon', 'color', 'select', 'toggle', 'number', 'action'):
            return
        if isinstance(value, str):
            seg = path.rsplit('.', 1)[-1]
            out.append(Leaf(path, kind if kind in ('text', 'textarea', 'richtext', 'href', 'url') else
                            ('href' if seg in ('href', 'to') else 'other'), value))
        elif isinstance(value, dict):
            for k, v in value.items():
                walk(v, f'{path}.{k}' if path else str(k), f'{key}.{k}' if key else str(k))
        elif isinstance(value, list):
            for n, v in enumerate(value):
                walk(v, f'{path}.{n}', f'{key}[]')

    walk(props if isinstance(props, dict) else {}, '', '')
    return out


def is_empty(kind, value) -> bool:
    """Nothing to show: no text, or a button without its words or its destination."""
    if value is None:
        return True
    if isinstance(value, dict):
        return not str(value.get('label') or '').strip() or not str(value.get('href') or '').strip()
    if kind == 'link':
        return True
    if kind == 'richtext':
        return not _plain('richtext', str(value)).strip()
    if isinstance(value, (list, tuple)):
        return not value
    return not str(value).strip()


def show(kind, value, values: dict, assets: dict | None = None) -> str:
    """A field value as visitors read it: tokens resolved, no HTML, a link as «texto → destino»."""
    if value is None or value == '' or value == [] or value == {}:
        return ''
    if kind == 'link' or (isinstance(value, dict) and ('href' in value or 'label' in value)):
        if not isinstance(value, dict):
            return _clip(str(value))
        label = _plain('text', render(str(value.get('label') or ''), values))
        href = render(str(value.get('href') or ''), values).strip()
        return _clip(f'{label} → {href}' if label and href else label or href)
    if kind == 'image':
        if isinstance(value, int) and not isinstance(value, bool):
            a = (assets or {}).get(value)
            return f'Imagen «{a.filename}»' if a is not None else f'Imagen n.º {value} de la biblioteca'
        return f'Foto del sitio «{str(value).rsplit("/", 1)[-1]}»'
    if kind == 'toggle' or isinstance(value, bool):
        return 'Sí' if value else 'No'
    if kind == 'table' and isinstance(value, dict):
        head = ' | '.join(str((c or {}).get('label') or '') for c in value.get('columns') or [] if isinstance(c, dict))
        rows = [' | '.join(render(str(c or ''), values) for c in r) for r in value.get('rows') or [] if isinstance(r, list)]
        return _clip(' / '.join(x for x in [head, *rows] if x))
    if isinstance(value, str):
        return _clip(_plain(kind or 'text', render(value, values)))
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return f'{len(value)} elemento' + ('' if len(value) == 1 else 's')
    return _clip(json.dumps(value, ensure_ascii=False))


def _show_field(block_type, field: str, value, values) -> str:
    kind = kind_at(block_type, field) or ('image' if field.endswith('.image') or field in ('image', 'poster') else None)
    return show(kind, value, values)


# ═══ issues ══════════════════════════════════════════════════════════════════
def _lower(s: str) -> str:
    return s[0].lower() + s[1:] if s else s


def _key(code: str, block_id, index, field: str) -> str:
    return f'{code}:{block_id if block_id else (index if index is not None else "page")}:{field}'


def make_issue(level, code, blocks, index, path, short, *, full='', value=_MISSING, preview='', fix=None) -> dict:
    """An issue in a section and field, shaped like checks.run_checks's, plus key, value, preview and fix."""
    loc = located_error(blocks, index, path, short)
    t = blocks[index].get('type')
    props = blocks[index].get('props') or {}
    field = loc['field']
    return {
        'level': level, 'code': code, 'key': _key(code, loc['block_id'], index, field),
        'message': full or f'{where(t, index, path)}: {_lower(short)}',
        'block_index': index, 'block_id': loc['block_id'], 'block_label': loc['block_label'],
        'field': field, 'field_label': loc['field_label'], 'field_message': short,
        'value': get_at(props, field) if value is _MISSING else value, 'preview': preview, 'fix': fix,
    }


SEO_LABELS = {'title': 'Título SEO', 'description': 'Descripción SEO'}


def seo_issue(level, code, name, short, *, value, preview='', fix=None) -> dict:
    label = SEO_LABELS.get(name, name)
    return {
        'level': level, 'code': code, 'key': _key(code, None, None, f'seo.{name}'),
        'message': f'SEO, campo «{label}»: {_lower(short)}', 'block_index': None, 'block_id': None,
        'block_label': '', 'field': f'seo.{name}', 'field_label': f'SEO{LABEL_SEP}{label}', 'field_message': short,
        'value': value, 'preview': preview, 'fix': fix,
    }


def _fix(kind, label, block_type, props, leaf_path, new_leaf, values, *, field=None) -> dict | None:
    """The quick fix of a leaf as the new value of its editor field (what the editor writes back)."""
    field = field if field is not None else field_path(block_type, leaf_path)
    if not field:
        return None
    new = copy.deepcopy(props if isinstance(props, dict) else {})
    try:
        set_at(new, leaf_path, new_leaf)
    except (IndexError, ValueError, TypeError, AttributeError):
        return None
    value = get_at(new, field)
    return {'kind': kind, 'label': label, 'value': value, 'preview': _show_field(block_type, field, value, values)}


def _token_list(tokens: list[str]) -> str:
    return tokens[0] if len(tokens) == 1 else ', '.join(tokens[:-1]) + ' y ' + tokens[-1]


def _list_siblings(defaults: dict, parts: list[str]) -> list:
    """The same field in every item of the design's list (``items.3.value``: each default item's ``value``)."""
    n = max(k for k, p in enumerate(parts) if p.isdigit())
    items = get_at(defaults, '.'.join(parts[:n]))
    rest = '.'.join(parts[n + 1:])
    return [get_at(it, rest) for it in items] if isinstance(items, list) and rest else []


def _baseline_block(baseline: dict, block: dict) -> dict | None:
    b = baseline.get(block.get('id'))
    return b if b is not None and b.get('type') == block.get('type') else None


def content_issues(slug: str, blocks: list, seo: dict, baseline_blocks, values: dict) -> list[dict]:
    """The content rules (module docstring) over the visible sections and the SEO texts."""
    issues: list[dict] = []
    private_page = slug in PRIVATE_PAGE_SLUGS
    baseline = {b.get('id'): b for b in baseline_blocks or [] if isinstance(b, dict) and b.get('id')}
    m0033 = _ficha_migration()

    for i, b in enumerate(blocks):
        if not isinstance(b, dict) or b.get('hidden'):
            continue
        t = b.get('type')
        props = b.get('props') if isinstance(b.get('props'), dict) else {}
        base = _baseline_block(baseline, b)
        base_props = merged(t, base.get('props')) if base else None
        defaults = defaults_of(t)
        required = set(_entry(t).get('required') or {})
        flagged: dict[str, set[str]] = {}   # editor field -> codes already reported

        def add(issue, _flagged=flagged):
            issues.append(issue)
            _flagged.setdefault(issue['field'], set()).add(issue['code'])

        for leaf in leaves(t, props):
            s = leaf.value if isinstance(leaf.value, str) else ''
            # ── private links ──
            if not private_page:
                if leaf.kind == 'href' and private_target(s):
                    target = private_target(s)
                    parent_path = leaf.path[:-len('.href')] if leaf.path.endswith('.href') else ''
                    parent = get_at(props, parent_path) if parent_path else None
                    field = field_path(t, leaf.path)
                    if isinstance(parent, dict) and field == parent_path:
                        fix = _fix('replace_link', 'Cambiar por «Agendar visita»', t, props, parent_path,
                                   {**parent, **VISIT}, values, field=field)
                    else:
                        fix = _fix('replace_link', 'Cambiar por /agendar-visita', t, props, leaf.path, VISIT['href'], values)
                    add(make_issue('error', 'private_link', blocks, i, leaf.path, _private_message(target),
                                   preview=_show_field(t, field, get_at(props, field), values), fix=fix))
                elif leaf.kind in TEXT_KINDS and s and ('<a' in s or '](' in s):
                    hrefs = [h for h in _HREF_RE.findall(s) + [m.group(2) for m in _MARK_LINK_RE.finditer(s)] if private_target(h)]
                    if hrefs:
                        fixed = _unlink_private(s)
                        fix = _fix('unlink', 'Quitar el enlace (el texto se queda)', t, props, leaf.path, fixed, values) \
                            if leaf.kind != 'cell' else None
                        add(make_issue('error', 'private_link', blocks, i, leaf.path, _private_message(private_target(hrefs[0])),
                                       preview=_plain(leaf.kind, render(s, values)), fix=fix))
                elif leaf.kind == 'form' and s.strip() == 'pre-registro':
                    add(make_issue('error', 'private_link', blocks, i, leaf.path,
                                   'Este formulario es la ficha de inscripción, que es personal. Elija otro formulario o quite la sección.'))
            if not s or '{' not in s and '}' not in s:
                continue
            field = field_path(t, leaf.path)
            # ── unknown tokens (any text, links too) ──
            wrong, repaired = unknown_tokens(s)
            if wrong:
                shown = ', '.join(f'«{w}»' for w in wrong)
                if repaired is None:
                    fix = None
                else:
                    better = sorted({m.group(0) for m in TOKEN_RE.finditer(repaired)} - {m.group(0) for m in TOKEN_RE.finditer(s)})
                    label = f'Cambiar por {_token_list(better)}' if better else f'Quitar {_token_list(wrong)}'
                    fix = _fix('replace_token' if better else 'remove_token', label, t, props, leaf.path, repaired, values) \
                        if leaf.kind != 'cell' else None
                add(make_issue('error', 'unknown_token', blocks, i, leaf.path,
                               f'{shown} no es un dato que el sitio conozca: las familias lo verían tal cual. '
                               'Use los datos de «Insertar dato».',
                               preview=_plain(leaf.kind, render(s, values)), fix=fix))
            if leaf.kind not in TEXT_KINDS:
                continue
            # ── a label holding only tokens ──
            if leaf.kind in LABEL_KINDS and TOKEN_ONLY_RE.match(s):
                default = get_at(defaults, leaf.path)
                before = get_at(base_props, leaf.path) if base_props is not None else None
                parts = leaf.path.split('.')
                in_list = any(p.isdigit() for p in parts)
                siblings = _list_siblings(defaults, parts) if in_list else []
                intended = any(isinstance(v, str) and bool(TOKEN_ONLY_RE.match(v)) for v in [default, *siblings])
                # In a list, or for a prop the design does not know, the field's name tells (a stat «value», a «year»).
                guess = (default is None or in_list) and TOKEN_FIELD_RE.search(parts[-1] or '')
                already_live = base is not None and before == s and base_props is not None
                if not (intended or guess or already_live):
                    restore = next((v for v in (before, default) if isinstance(v, str) and v.strip() and not TOKEN_ONLY_RE.match(v)), None)
                    if restore is not None:
                        fix = _fix('restore', 'Restaurar el valor original', t, props, leaf.path, restore, values)
                    elif field.split('.')[0] in required:
                        fix = None
                    else:
                        fix = _fix('clear', 'Vaciar', t, props, leaf.path, '', values)
                    rendered = render(s, values)
                    add(make_issue('warning', 'token_only_label', blocks, i, leaf.path,
                                   f'Solo tiene datos automáticos ({s.strip()}): se verá «{rendered.strip()}». '
                                   'Parece que se insertaron por error.',
                                   preview=rendered.strip(), fix=fix))
                    continue
            # ── tokens glued to text ──
            glued = glued_fix(s)
            if glued:
                fixed, removed, spaced = glued
                rendered = _plain(leaf.kind, render(s, values))
                if removed and not spaced:
                    label = f'Quitar {_token_list(removed)}'
                elif spaced and not removed:
                    label = 'Separar con un espacio'
                else:
                    label = 'Corregir los datos pegados'
                fix = _fix('remove_token' if removed else 'add_space', label, t, props, leaf.path, fixed, values) \
                    if leaf.kind != 'cell' else None
                what = _token_list(removed) if removed else 'Un dato'
                add(make_issue('warning', 'token_glued', blocks, i, leaf.path,
                               f'{what} quedó pegado al texto: se verá «{rendered}».',
                               preview=rendered, fix=fix))

        # ── a text the design fills, emptied by this draft ──
        if '.' in str(t) and base_props is not None:
            now = merged(t, props)
            for key, kind in kinds_of(t).items():
                if '.' in key or '[]' in key or kind not in ('text', 'textarea', 'richtext', 'link') or key in required:
                    continue
                if is_empty(kind, now.get(key)) and not is_empty(kind, base_props.get(key)) and key not in flagged:
                    before = base_props.get(key)
                    fix = {'kind': 'restore', 'label': 'Restaurar el valor original', 'value': copy.deepcopy(before),
                           'preview': show(kind, before, values)}
                    add(make_issue('warning', 'empty_required', blocks, i, key,
                                   f'Quedó vacío: en la página esta parte se verá sin texto. Antes decía «{show(kind, before, values)}».',
                                   value=now.get(key), preview='', fix=fix))

        # ── values the designs retired (migration 0033) ──
        if m0033 is not None:
            try:
                new_block, changed = m0033.update_block({**b, 'props': dict(props)})
            except Exception:  # noqa: BLE001 - a malformed draft never breaks the review
                new_block, changed = b, False
            if changed:
                new_props = new_block.get('props') or {}
                for key, new_value in new_props.items():
                    if props.get(key) == new_value:
                        continue
                    codes = flagged.get(key) or set()
                    if 'private_link' in codes:
                        # The private-link fix brings the design's current button (same as 0033's).
                        for issue in issues:
                            if issue['field'] == key and issue['code'] == 'private_link' and issue['block_index'] == i and issue['fix']:
                                issue['fix']['value'] = copy.deepcopy(new_value)
                                issue['fix']['preview'] = _show_field(t, key, new_value, values)
                        continue
                    add(make_issue('warning', 'restored_old_default', blocks, i, key,
                                   'Tiene un texto anterior del diseño, de cuando la ficha de inscripción era pública. '
                                   'Use el texto actual.',
                                   preview=_show_field(t, key, props.get(key), values),
                                   fix={'kind': 'restore', 'label': 'Usar el texto actual', 'value': copy.deepcopy(new_value),
                                        'preview': _show_field(t, key, new_value, values)}))

    # ── SEO texts ──
    for name in ('title', 'description'):
        s = (seo or {}).get(name)
        if not isinstance(s, str) or ('{' not in s and '}' not in s):
            continue
        wrong, repaired = unknown_tokens(s)
        if wrong:
            better = sorted({m.group(0) for m in TOKEN_RE.finditer(repaired or '')} - {m.group(0) for m in TOKEN_RE.finditer(s)})
            fix = None if repaired is None else {
                'kind': 'replace_token' if better else 'remove_token',
                'label': f'Cambiar por {_token_list(better)}' if better else f'Quitar {_token_list(wrong)}',
                'value': repaired, 'preview': render(repaired, values)}
            issues.append(seo_issue('error', 'unknown_token', name,
                                    f'{", ".join(f"«{w}»" for w in wrong)} no es un dato que el sitio conozca: se vería tal cual en Google.',
                                    value=s, preview=render(s, values), fix=fix))
        glued = glued_fix(s)
        if glued:
            fixed, removed, _spaced = glued
            issues.append(seo_issue('warning', 'token_glued', name,
                                    f'{_token_list(removed) if removed else "Un dato"} quedó pegado al texto: se verá «{render(s, values)}».',
                                    value=s, preview=render(s, values),
                                    fix={'kind': 'remove_token' if removed else 'add_space',
                                         'label': f'Quitar {_token_list(removed)}' if removed else 'Separar con un espacio',
                                         'value': fixed, 'preview': render(fixed, values)}))
    return issues


@lru_cache(maxsize=1)
def _ficha_migration():
    """Migration 0033's rules (the retired ficha defaults and their replacements), or None."""
    try:
        return importlib.import_module('apps.content.migrations.0033_ficha_privada_links')
    except Exception:  # noqa: BLE001
        logger.warning('publish_checks: migration 0033 rules not available', exc_info=True)
        return None


def _augment(issues: list[dict], blocks: list, values: dict) -> list[dict]:
    """checks.run_checks issues in this module's shape (key, value, preview, fix)."""
    for issue in issues:
        i = issue.get('block_index')
        field = issue.get('field') or ''
        b = blocks[i] if isinstance(i, int) and 0 <= i < len(blocks) and isinstance(blocks[i], dict) else None
        t = b.get('type') if b else None
        props = (b.get('props') or {}) if b else {}
        issue.setdefault('block_index', i)
        issue.setdefault('field', field)
        issue.setdefault('field_label', '')
        issue.setdefault('block_label', block_label(t) if b else '')
        issue.setdefault('field_message', issue.get('message', ''))
        issue['key'] = _key(issue['code'], issue.get('block_id'), i, field)
        value = get_at(props, field) if b and field else None
        issue['value'] = value
        issue['preview'] = _show_field(t, field, value, values) if b and field else ''
        fix = None
        if b and field and issue['code'] == 'required':
            default = get_at(defaults_of(t), field)
            if not is_empty(kind_at(t, field), default):
                fix = {'kind': 'restore', 'label': 'Restaurar el valor original', 'value': copy.deepcopy(default),
                       'preview': _show_field(t, field, default, values)}
        elif b and issue['code'] == 'locked_hidden':
            fix = {'kind': 'show_section', 'label': 'Mostrar la sección', 'value': None, 'preview': ''}
        issue['fix'] = fix
    return issues


# ═══ «Qué cambia» ════════════════════════════════════════════════════════════
def design_blocks(slug: str) -> list[dict] | None:
    """The page's design as the site shows it before any edit (frontend templateBlocks), or None for a custom page."""
    from .page_templates import template_manifest

    tpl = template_manifest().get(slug) or {}
    sections = tpl.get('sections')
    if not sections:
        return None
    out = []
    for n, e in enumerate(sections, start=1):
        t = e.get('type')
        b = {'id': f'{slug}-{n}', 'type': t, 'props': {**copy.deepcopy(defaults_of(t)), **copy.deepcopy(e.get('props') or {})}}
        if e.get('hidden'):
            b['hidden'] = True
        out.append(b)
    return out


def baseline_for(page: Page) -> tuple[list | None, dict, str]:
    """(blocks, seo, what) the public site shows today: 'published' version, the 'design', or 'none'."""
    if page.status == Page.Status.PUBLISHED and page.published_version_id and page.published_version is not None:
        v = page.published_version
        return v.blocks or [], v.seo or {}, 'published'
    design = design_blocks(page.slug)
    if design is not None:
        return design, {}, 'design'
    return None, {}, 'none'


def editor_fields(block_type, props: dict) -> dict[str, tuple[str, object]]:
    """{editor path: (kind, value)} of a block, list items one by one («Tarjetas › elemento 2 › Título»)."""
    kinds = kinds_of(block_type)
    out: dict[str, tuple[str, object]] = {}
    top = [k for k in kinds if '.' not in k and '[]' not in k]
    for key in dict.fromkeys([*top, *props]):
        if key not in props:
            continue
        v, kind = props[key], kinds.get(key)
        if kind == 'action':
            continue
        if kind == 'items' and isinstance(v, list):
            subs = [k.split('.', 1)[1] for k in kinds if k.startswith(f'{key}[].') and k.count('.') == 1]
            for n, it in enumerate(v):
                if not isinstance(it, dict):
                    out[f'{key}.{n}'] = ('other', it)
                    continue
                for sk in dict.fromkeys([*subs, *it]):
                    if sk in it:
                        out[f'{key}.{n}.{sk}'] = (kinds.get(f'{key}[].{sk}') or 'other', it[sk])
        elif kind == 'images' and isinstance(v, list):
            for n, it in enumerate(v):
                it = it if isinstance(it, dict) else {'image': it}
                out[f'{key}.{n}.image'] = ('image', it.get('image'))
                if it.get('caption'):
                    out[f'{key}.{n}.caption'] = ('text', it.get('caption'))
        else:
            out[key] = (kind or 'other', v)
    return out


def _canon(v) -> str:
    return json.dumps(v, sort_keys=True, ensure_ascii=False)


def _summary(block_type, props: dict, values) -> str:
    """First words of a section (its title, else its first text): how «Qué cambia» names it."""
    for key in ('title', 'heading', 'label', 'eyebrow', 'text', 'html', 'subtitle'):
        v = props.get(key)
        if isinstance(v, str) and v.strip():
            return show(kind_at(block_type, key) or 'text', v, values)
    for _path, (kind, v) in editor_fields(block_type, props).items():
        if kind in ('text', 'textarea', 'richtext') and isinstance(v, str) and v.strip():
            return show(kind, v, values)
    return ''


def _code(kind, value) -> str:
    """The stored text with its tokens, when it has any (shown small under the rendered one)."""
    if isinstance(value, str) and '{{' in value:
        return value
    if isinstance(value, dict) and '{{' in str(value.get('label') or ''):
        return str(value.get('label'))
    return ''


def _change(kind, index, block, *, field='', before='', after='', before_code='', after_code='') -> dict:
    t = block.get('type') if block else None
    return {
        'kind': kind, 'block_index': index, 'block_id': (block or {}).get('id'), 'block_label': block_label(t) if block else '',
        'field': field, 'field_label': field_label(t, field) if field and t else '',
        'before': before, 'after': after, 'before_code': before_code, 'after_code': after_code,
    }


def diff(blocks: list, seo: dict, base_blocks, base_seo: dict, values: dict, assets: dict | None = None) -> list[dict]:
    """«Qué cambia»: the draft against what the site shows today, field by field, as visitors read it."""
    changes: list[dict] = []
    base = {b.get('id'): (n, b) for n, b in enumerate(base_blocks or []) if isinstance(b, dict) and b.get('id')}
    matched: list[str] = []
    for i, b in enumerate(blocks or []):
        if not isinstance(b, dict):
            continue
        t = b.get('type')
        old = base.get(b.get('id'))
        if old is None or old[1].get('type') != t:
            if not b.get('hidden'):
                changes.append(_change('added', i, b, after=_summary(t, merged(t, b.get('props')), values)))
            continue
        matched.append(b.get('id'))
        ob = old[1]
        if bool(b.get('hidden')) != bool(ob.get('hidden')):
            changes.append(_change('hidden' if b.get('hidden') else 'shown', i, b,
                                   before=_summary(t, merged(t, ob.get('props')), values)))
            continue
        if b.get('hidden'):
            continue
        now, then = editor_fields(t, merged(t, b.get('props'))), editor_fields(t, merged(t, ob.get('props')))
        for path in dict.fromkeys([*now, *then]):
            kn, vn = now.get(path, (None, None))
            kb, vb = then.get(path, (None, None))
            if _canon(vn) == _canon(vb):
                continue
            kind = kn or kb
            before, after = show(kind, vb, values, assets), show(kind, vn, values, assets)
            code_b, code_a = _code(kind, vb), _code(kind, vn)
            if before == after and code_b == code_a:
                continue
            changes.append(_change('changed', i, b, field=path, before=before, after=after, before_code=code_b, after_code=code_a))
    kept = set(matched)
    for bid, (_n, ob) in base.items():
        if bid not in kept and not ob.get('hidden'):
            changes.append(_change('removed', None, ob, before=_summary(ob.get('type'), merged(ob.get('type'), ob.get('props')), values)))
    base_order = [bid for bid in base if bid in kept]
    if matched != base_order:
        changes.append({**_change('moved', None, None), 'after': 'El orden de las secciones cambió.'})
    for name, label in (('title', 'Título SEO'), ('description', 'Descripción SEO'), ('noindex', 'Ocultar de Google'), ('og_image', 'Imagen al compartir')):
        vn, vb = (seo or {}).get(name), (base_seo or {}).get(name)
        if _canon(vn if vn not in ('', None, False) else None) == _canon(vb if vb not in ('', None, False) else None):
            continue
        kind = 'toggle' if name == 'noindex' else ('image' if name == 'og_image' else 'text')
        changes.append({**_change('changed', None, None, field=f'seo.{name}', before=show(kind, vb, values, assets),
                                  after=show(kind, vn, values, assets), before_code=_code(kind, vb), after_code=_code(kind, vn)),
                        'block_label': 'SEO', 'field_label': f'SEO{LABEL_SEP}{label}'})
    if len(changes) > MAX_CHANGES:
        rest = len(changes) - MAX_CHANGES
        changes = changes[:MAX_CHANGES] + [{**_change('more', None, None), 'after': f'y {rest} cambios más'}]
    return changes


def _sections(n: int) -> str:
    return f'{n} sección' if n == 1 else f'{n} secciones'


def large_change(changes: list[dict]) -> dict | None:
    removed = [c for c in changes if c['kind'] == 'removed']
    hidden = [c for c in changes if c['kind'] == 'hidden']
    fields = [c for c in changes if c['kind'] == 'changed']
    parts = []
    if removed:
        names = ', '.join(f'«{c["block_label"]}»' for c in removed[:3]) + (' y otras' if len(removed) > 3 else '')
        parts.append(f'quita {_sections(len(removed))} ({names})')
    if hidden:
        parts.append(f'oculta {_sections(len(hidden))}')
    if len(fields) > LARGE_CHANGE_FIELDS:
        parts.append(f'cambia {len(fields)} campos a la vez')
    if not parts:
        return None
    what = parts[0] if len(parts) == 1 else ', '.join(parts[:-1]) + ' y ' + parts[-1]
    message = f'Este borrador {what}. Revise «Qué cambia» antes de publicar.'
    return {'level': 'warning', 'code': 'large_change', 'key': 'large_change:page:', 'message': message,
            'block_index': None, 'block_id': None, 'block_label': '', 'field': '', 'field_label': '',
            'field_message': message, 'value': None, 'preview': '', 'fix': None}


# ═══ the review ══════════════════════════════════════════════════════════════
def review(page: Page, *, blocks=None, seo=None, ctx: CheckContext | None = None, live: bool = False) -> dict:
    """Every check of a page's draft (or of ``blocks``/``seo``, an unsaved draft; ``live``: of its published version).

    ``ctx`` shares lookups between pages (checks.CheckContext). The live review
    has no «Qué cambia» and no change-based warnings.
    """
    if live:
        v = page.published_version
        blocks, seo = (v.blocks or []) if v else [], (v.seo or {}) if v else {}
    blocks = page.draft_blocks if blocks is None else blocks
    seo = page.seo if seo is None else seo
    blocks = blocks if isinstance(blocks, list) else []
    seo = seo if isinstance(seo, dict) else {}
    target = page if (blocks is page.draft_blocks and seo is page.seo) else Page(
        pk=page.pk, slug=page.slug, title=page.title, template=page.template, status=page.status, draft_blocks=blocks, seo=seo)
    values = (ctx.tokens if ctx is not None and ctx.tokens else None) or token_values()
    if live:
        base_blocks, base_seo, base_kind = None, {}, 'none'
    else:
        base_blocks, base_seo, base_kind = baseline_for(page)
        design_ids = {b['id'] for b in base_blocks or []} if base_kind == 'design' else set()
        if base_kind == 'design' and not any(isinstance(b, dict) and b.get('id') in design_ids for b in blocks):
            # A draft not made from the design (an old seed, a page built elsewhere): nothing to compare
            # section by section, so «Qué cambia» lists its sections as new instead of «removed» ones.
            base_blocks = None
    issues = _augment(run_checks(target, ctx), blocks, values)
    issues += content_issues(page.slug, blocks, seo, base_blocks, values)
    changes: list[dict] = []
    if not live:
        changes = diff(blocks, seo, base_blocks, base_seo, values, ctx.assets if ctx is not None else None)
        big = large_change(changes)
        if big:
            issues.append(big)
    # Two rules never report the same slip twice; two slips in one field keep apart keys.
    unique, said, count = [], set(), {}
    for issue in issues:
        if (issue['key'], issue['message']) in said:
            continue
        said.add((issue['key'], issue['message']))
        count[issue['key']] = n = count.get(issue['key'], 0) + 1
        if n > 1:
            issue['key'] = f'{issue["key"]}#{n}'
        unique.append(issue)
    issues = unique
    for issue in issues:
        issue['acknowledge'] = issue['level'] == 'warning' and issue['code'] not in SUGGESTIONS
    rank = {'error': 0, 'warning': 1}
    issues.sort(key=lambda i: (rank.get(i['level'], 2), not i['acknowledge'],
                               i['block_index'] if i['block_index'] is not None else 10_000))
    errors = [i for i in issues if i['level'] == 'error']
    warnings = [i for i in issues if i['acknowledge']]
    suggestions = [i for i in issues if i['level'] != 'error' and not i['acknowledge']]
    return {'ok': not errors, 'errors': errors, 'warnings': warnings, 'suggestions': suggestions, 'issues': issues,
            'changes': changes, 'baseline': base_kind}


def summarize(report: dict) -> dict:
    """Counts and the first problem's short name, for the «Contenido» chips."""
    first = lambda items: ({'code': items[0]['code'], 'label': CODE_LABELS.get(items[0]['code'], 'revisar')} if items else None)  # noqa: E731
    return {'errors': len(report['errors']), 'warnings': len(report['warnings']),
            'first_error': first(report['errors']), 'first_warning': first(report['warnings'])}


# ═══ the gate ════════════════════════════════════════════════════════════════
PUBLISH_BLOCKED = 'publish_blocked'
PUBLISH_WARNINGS = 'publish_warnings'


def publish_refusal(report: dict, data) -> dict | None:
    """The 409 body that stops a publication, or None to go ahead.

    Errors always stop it. Warnings stop it unless ``acknowledge_warnings`` is
    true; when the request also lists ``acknowledged_warnings`` (keys), a
    warning that appeared after the person read the list stops it again.
    """
    body = {'errors': report['errors'], 'warnings': report['warnings'], 'suggestions': report['suggestions'],
            'issues': report['issues'], 'changes': report['changes']}
    if report['errors']:
        return {'code': PUBLISH_BLOCKED, **body,
                'detail': 'Corrija antes de publicar: ' + ' · '.join(e['message'] for e in report['errors'][:5])}
    if report['warnings']:
        get = data.get if hasattr(data, 'get') else (lambda _k, _d=None: None)
        ok = confirmed(get('acknowledge_warnings'))
        acked = get('acknowledged_warnings')
        if ok and isinstance(acked, list):
            ok = {w['key'] for w in report['warnings']} <= {str(k) for k in acked}
        if not ok:
            n = len(report['warnings'])
            return {'code': PUBLISH_WARNINGS, **body,
                    'detail': (f'Revise {"la advertencia" if n == 1 else f"las {n} advertencias"} antes de publicar: '
                               + ' · '.join(w['message'] for w in report['warnings'][:3])
                               + ' Si todo está bien así, confírmelo y vuelva a publicar.')}
    return None


def schedule_blockers(report: dict) -> list[dict]:
    """What stops a scheduled publication: every error and the warnings that are almost always a slip."""
    return report['errors'] + [w for w in report['warnings'] if w['code'] in SCHEDULE_BLOCKING]


# ═══ notifications ═══════════════════════════════════════════════════════════
NOTICE_DEDUPE = dt.timedelta(days=7)


def editor_url(page: Page) -> str:
    return f"{(getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')}/admin/contenido/{page.pk}"


def _bullets(items: list[dict], limit: int = 6) -> str:
    lines = [f'- {i["message"]}' for i in items[:limit]]
    if len(items) > limit:
        lines.append(f'- y {len(items) - limit} más')
    return '\n'.join(lines)


def notify_admins(title: str, message: str, url: str) -> int:
    """The bell (and e-mail) of every active administrator, once: the same notice within a week is not repeated."""
    from apps.accounts.models import User
    from apps.portal.models import Notification
    from apps.portal.services import notify

    since = timezone.now() - NOTICE_DEDUPE
    sent = 0
    for admin in User.objects.filter(role='admin', is_active=True):
        if Notification.objects.filter(user=admin, title=title, message=message, created_at__gte=since).exists():
            continue
        try:
            notify(admin, 'warning', title, message, url=url, cta_label='Abrir el editor', fanout=False)
            sent += 1
        except Exception:  # noqa: BLE001 - a failed notice never stops the scheduler
            logger.exception('publish_checks: notice to %s failed', admin.pk)
    return sent


def notify_schedule_blocked(page: Page, blockers: list[dict]) -> int:
    from .navigation import page_path

    when = timezone.localtime(page.publish_at).strftime('%d/%m/%Y %H:%M') if page.publish_at else ''
    n = len(blockers)
    title = f'Publicación programada detenida: {page.title}'
    message = (f'La página {page_path(page.slug)} debía publicarse el {when} y sigue sin publicarse: '
               f'{"tiene un problema" if n == 1 else f"tiene {n} problemas"} por revisar.\n\n{_bullets(blockers)}\n\n'
               f'Ábrala en el editor, use «Revisar», corrija y publíquela: {editor_url(page)}')
    return notify_admins(title, message, editor_url(page))


def notify_live_problem(page: Page, errors: list[dict]) -> int:
    from .navigation import page_path

    n = len(errors)
    title = f'Página publicada con {"un problema" if n == 1 else f"{n} problemas"}: {page.title}'
    message = (f'La página {page_path(page.slug)} que ven las familias tiene '
               f'{"un problema" if n == 1 else f"{n} problemas"}:\n\n{_bullets(errors)}\n\n'
               f'Corríjalo en el editor y vuelva a publicar: {editor_url(page)}')
    return notify_admins(title, message, editor_url(page))


def pages_context(pages: list[Page], *, drafts: bool = True, live: bool = True) -> CheckContext:
    """One CheckContext for these pages' drafts and published versions: constant queries.

    ``pages`` must hold every published page (their addresses are valid link targets).
    """
    used = [(p.draft_blocks, p.seo) for p in pages] if drafts else []
    if live:
        used += [(p.published_version.blocks, p.published_version.seo) for p in pages if p.published_version_id and p.published_version]
    ctx = CheckContext.build(used, published_slugs=[p.slug for p in pages if p.status == Page.Status.PUBLISHED])
    ctx.tokens = token_values()
    return ctx


def audit_live_pages() -> list[tuple[Page, list[dict]]]:
    """Every published page as families see it; Dirección is told about each one with an error.

    Runs with the scheduler (cms_schedule): a deploy that makes a route private,
    an image deleted from the library or a redirect removed shows up within
    minutes, not when someone happens to open the editor.
    """
    pages = list(Page.objects.select_related('published_version').filter(status=Page.Status.PUBLISHED))
    ctx = pages_context(pages, drafts=False)
    problems = []
    for page in pages:
        if not page.published_version_id or page.published_version is None:
            continue
        errors = review(page, ctx=ctx, live=True)['errors']
        if errors:
            problems.append((page, errors))
            notify_live_problem(page, errors)
    return problems
