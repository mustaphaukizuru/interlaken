"""Header buttons in SiteSettings.chrome keep their optional icon (menu «Opción 3», 2026-11-20)."""

from apps.content.navigation import validate_chrome


def test_header_button_keeps_icon():
    out = validate_chrome(
        {
            "header_buttons": [
                {"label": "Portal Cafetería", "href": "/login", "icon": " Coffee "},
                {"label": "Agendar visita", "href": "/agendar-visita", "primary": True},
            ]
        }
    )
    assert out["header_buttons"] == [
        {"label": "Portal Cafetería", "href": "/login", "primary": False, "icon": "Coffee"},
        {"label": "Agendar visita", "href": "/agendar-visita", "primary": True},
    ]


def test_header_button_icon_is_trimmed_to_40_chars():
    out = validate_chrome({"header_buttons": [{"label": "X", "href": "/x", "icon": "A" * 80}]})
    assert out["header_buttons"][0]["icon"] == "A" * 40


def test_old_placement_key_is_dropped():
    """Header version 3 (2026-11-23) has no «Solo ícono en celular y tableta» button: a saved `placement` goes away on save."""
    out = validate_chrome({"header_buttons": [{"label": "Colegiaturas", "href": "https://interlaken.servoescolar.mx/", "icon": "CreditCard", "placement": "mobile_icon"}]})
    assert out["header_buttons"] == [{"label": "Colegiaturas", "href": "https://interlaken.servoescolar.mx/", "primary": False, "icon": "CreditCard"}]


def test_header_v3_texts_are_kept():
    out = validate_chrome({"nav_payments": "  Pagos de familias ", "sticky_icon": "CreditCard"})
    assert out["nav_payments"] == "Pagos de familias"
    assert out["sticky_icon"] == "CreditCard"


def test_visit_label_is_the_bubble_text():
    """«Agendar visita» has one text (float_visit) for the pill, the menu and the bubble."""
    assert "nav_visit" not in validate_chrome({"nav_visit": "Visítenos"})
