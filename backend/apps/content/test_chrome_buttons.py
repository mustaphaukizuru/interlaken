"""Header buttons in SiteSettings.chrome keep their optional icon (menu «Opción 3», 2026-11-20)."""

import pytest
from rest_framework import serializers

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


def test_mobile_icon_placement_is_kept():
    """«Colegiaturas» (owner, 2026-11-23): only an icon in the phone/tablet bar."""
    out = validate_chrome(
        {
            "header_buttons": [
                {"label": "Colegiaturas", "href": "https://interlaken.servoescolar.mx", "icon": "CircleDollarSign", "placement": "mobile_icon"},
                {"label": "Agendar visita", "href": "/agendar-visita", "primary": True, "placement": "all"},
            ]
        }
    )
    assert out["header_buttons"] == [
        {"label": "Colegiaturas", "href": "https://interlaken.servoescolar.mx", "primary": False, "icon": "CircleDollarSign", "placement": "mobile_icon"},
        {"label": "Agendar visita", "href": "/agendar-visita", "primary": True},
    ]


def test_mobile_icon_placement_needs_an_icon():
    with pytest.raises(serializers.ValidationError):
        validate_chrome({"header_buttons": [{"label": "Colegiaturas", "href": "/pagos", "placement": "mobile_icon"}]})


def test_unknown_placement_is_refused():
    with pytest.raises(serializers.ValidationError):
        validate_chrome({"header_buttons": [{"label": "X", "href": "/x", "icon": "Coffee", "placement": "footer"}]})
