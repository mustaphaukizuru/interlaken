"""Header buttons in SiteSettings.chrome keep their optional icon (menu «Opción 3», 2026-11-20)."""
from apps.content.navigation import validate_chrome


def test_header_button_keeps_icon():
    out = validate_chrome({'header_buttons': [
        {'label': 'Portal Cafetería', 'href': '/login', 'icon': ' Coffee '},
        {'label': 'Agendar visita', 'href': '/agendar-visita', 'primary': True},
    ]})
    assert out['header_buttons'] == [
        {'label': 'Portal Cafetería', 'href': '/login', 'primary': False, 'icon': 'Coffee'},
        {'label': 'Agendar visita', 'href': '/agendar-visita', 'primary': True},
    ]


def test_header_button_icon_is_trimmed_to_40_chars():
    out = validate_chrome({'header_buttons': [{'label': 'X', 'href': '/x', 'icon': 'A' * 80}]})
    assert out['header_buttons'][0]['icon'] == 'A' * 40
