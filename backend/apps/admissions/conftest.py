"""Fixtures shared by the admissions tests."""

import pytest


@pytest.fixture
def public_start(db):
    """Ajustes «Permitir iniciar la ficha sin enlace» turned ON.

    The ficha de inscripción is private since 2026-11-21 (off by default:
    only the personal link the school sends after admission opens one).
    Tests of the public start itself, and tests that use it as the quickest
    way to get a draft and a session, turn it on with this fixture.
    """
    from apps.content.models import SiteSettings

    settings = SiteSettings.load()
    settings.admissions_public_start = True
    settings.save()
    return settings
