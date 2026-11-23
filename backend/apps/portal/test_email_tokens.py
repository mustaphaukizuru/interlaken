"""Parity: the email and the Django admin use the site's colour tokens.

Emails and Unfold cannot read CSS variables, so they repeat the colours as
literals (§3.1.6 of docs/UIUX-REFINEMENT-PROMPT.md). This test reads the
token layer itself (``frontend/src/index.css`` ``:root`` and the Tailwind
``brand`` ramp) and fails when a literal drifts from it. Values that exist
only in email or only in Unfold's dark theme are allow-listed, with a reason.
It also pins the contrast the design promises (AA, 4.5:1, for text).
"""
import re
from pathlib import Path

import pytest
from django.conf import settings

from apps.portal import emailing

REPO = Path(settings.BASE_DIR).parent
INDEX_CSS = REPO / 'frontend' / 'src' / 'index.css'
TAILWIND = REPO / 'frontend' / 'tailwind.config.js'
EMAIL_TEMPLATE = Path(settings.BASE_DIR) / 'templates' / 'email' / 'base.html'

# A hex colour, never an HTML entity such as «&#847;».
HEX = re.compile(r'(?<!&)#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b')

# Unfold-only values (dark theme), with why.
UNFOLD_ONLY = {
    '#9A93AE': 'base-400: subtle text in Unfold dark mode (6.5:1 on base-900 #0f0a24). '
               'Light mode uses font.subtle-light = --text-light.',
}


def norm(value: str) -> str:
    value = value.strip().upper()
    if re.fullmatch(r'#[0-9A-F]{3}', value):
        value = '#' + ''.join(ch * 2 for ch in value[1:])
    return value


def _root_block(css: str) -> str:
    match = re.search(r':root\s*\{(.*?)\n\}', css, re.S)
    assert match, 'no :root block in index.css'
    return match.group(1)


def css_tokens() -> dict[str, str]:
    """``{'--purple': '#401A8E', ...}`` with ``var(--x)`` references resolved."""
    body = re.sub(r'/\*.*?\*/', '', _root_block(INDEX_CSS.read_text(encoding='utf-8')), flags=re.S)
    raw = dict(re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', body))

    def resolve(value: str, depth: int = 0) -> str:
        ref = re.fullmatch(r'var\((--[\w-]+)\)', value.strip())
        if ref and depth < 10:
            return resolve(raw.get(ref.group(1), ''), depth + 1)
        return value.strip()

    return {name: resolve(value) for name, value in raw.items()}


def token_colours() -> set[str]:
    colours = set()
    for value in css_tokens().values():
        colours |= {norm(h) for h in HEX.findall(value)}
    return colours


def tailwind_brand() -> dict[str, str]:
    text = TAILWIND.read_text(encoding='utf-8')
    block = re.search(r'\bbrand\s*:\s*\{(.*?)\}', text, re.S)
    assert block, 'no brand ramp in tailwind.config.js'
    return {stop: norm(hex_) for stop, hex_ in re.findall(r"(\d+)\s*:\s*'(#[0-9a-fA-F]{6})'", block.group(1))}


def luminance(hex_: str) -> float:
    hex_ = norm(hex_)[1:]
    channels = [int(hex_[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(fg: str, bg: str) -> float:
    a, b = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (a + 0.05) / (b + 0.05)


@pytest.fixture(scope='module')
def tokens():
    assert INDEX_CSS.exists(), f'{INDEX_CSS} is missing: the parity test needs the token layer'
    return token_colours()


EMAIL_ONLY = {norm(k) for k in emailing.EMAIL_ONLY}


class TestEmail:
    def test_every_tone_is_a_status_pair_token(self, tokens):
        for name, pair in emailing.TONES.items():
            for part in ('fg', 'bg'):
                assert norm(pair[part]) in tokens, f'TONES[{name!r}][{part!r}] {pair[part]} is not a token'

    def test_the_tone_keys_callers_pass_stay(self):
        assert set(emailing.TONES) == {'brand', 'success', 'warning', 'danger', 'neutral'}

    def test_every_palette_colour_is_a_token_or_documented(self, tokens):
        for role, value in emailing.PALETTE.items():
            assert norm(value) in tokens | EMAIL_ONLY, f'PALETTE[{role!r}] {value} is not a token'

    def test_every_colour_in_the_template_is_a_token_or_documented(self, tokens):
        html = EMAIL_TEMPLATE.read_text(encoding='utf-8')
        stray = {norm(h) for h in HEX.findall(html)} - tokens - EMAIL_ONLY
        assert not stray, f'base.html uses colours outside the tokens: {sorted(stray)}'

    def test_the_allowlist_is_short_and_explained(self):
        assert len(emailing.EMAIL_ONLY) <= 3
        assert all(len(reason) > 20 for reason in emailing.EMAIL_ONLY.values())

    def test_text_colours_pass_aa(self):
        p = emailing.PALETTE
        for name, pair in emailing.TONES.items():
            assert contrast(pair['fg'], pair['bg']) >= 4.5, name
        assert contrast(p['button_label'], p['button']) >= 4.5
        for fg in ('ink', 'body', 'muted', 'link'):
            assert contrast(p[fg], p['panel']) >= 4.5, fg
            assert contrast(p[fg], p['tint']) >= 4.5, fg
        assert contrast(p['muted'], p['page']) >= 4.5  # footer on the page

    def test_the_button_is_the_sites_primary_purple(self):
        assert norm(emailing.PALETTE['button']) == norm(css_tokens()['--purple'])


class TestUnfold:
    def test_primary_ramp_is_the_tailwind_brand_ramp(self, tokens):
        primary = {k: norm(v) for k, v in settings.UNFOLD['COLORS']['primary'].items()}
        brand = tailwind_brand()
        assert brand, 'empty brand ramp'
        for stop, value in brand.items():
            assert primary.get(stop) == value, f'primary-{stop} {primary.get(stop)} != brand-{stop} {value}'
        assert primary['950'] == norm(css_tokens()['--dark-3'])

    def test_base_ramp_is_tokens(self, tokens):
        allowed = tokens | {norm(k) for k in UNFOLD_ONLY}
        for stop, value in settings.UNFOLD['COLORS']['base'].items():
            assert norm(value) in allowed, f'base-{stop} {value} is not a token'

    def test_font_colours_are_tokens(self, tokens):
        for name, value in settings.UNFOLD['COLORS']['font'].items():
            if value.startswith('#'):
                assert norm(value) in tokens, f'font.{name} {value} is not a token'

    def test_light_caption_is_text_light_and_passes_aa(self):
        font = settings.UNFOLD['COLORS']['font']
        base = settings.UNFOLD['COLORS']['base']
        assert norm(font['subtle-light']) == norm(css_tokens()['--text-light'])
        for surface in ('#FFFFFF', base['50'], base['100']):
            assert contrast(font['subtle-light'], surface) >= 4.5, surface

    def test_dark_subtle_passes_aa_on_the_dark_surface(self):
        base = settings.UNFOLD['COLORS']['base']
        assert contrast(base['400'], base['900']) >= 4.5
