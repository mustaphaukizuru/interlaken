"""The school's staff fills a ficha with a family at the office (2026-11-21).

The ficha is private: with «Permitir iniciar la ficha sin enlace» off (the
default) a visitor or a family cannot start one, but an administrator or a
staff account with the «admisiones» area can, from /pre-registro («Vista del
personal»), and can then save every step, health included, with that
ficha's session. Synthetic data only.
"""

import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, UserFactory
from apps.accounts.models import User
from apps.admissions.factories import SECTION_DATA, salud_data, start_payload
from apps.admissions.models import Registration
from apps.content.models import SiteSettings

pytestmark = pytest.mark.django_db

START = reverse("register-create")


@pytest.fixture(autouse=True)
def _mail(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.ADMISSIONS_EMAIL = "admisiones@ejemplo.test"
    mail.outbox.clear()


def staff(*areas):
    return UserFactory(role=User.Role.STAFF, staff_areas=list(areas))


def test_the_public_start_is_off():
    assert SiteSettings.load().admissions_public_start is False


@pytest.mark.parametrize("who", [None, "parent", "staff_without_area"])
def test_visitors_families_and_other_staff_cannot_start(api_client, who):
    makers = {None: None, "parent": ParentFactory, "staff_without_area": lambda: staff("visitas")}
    user = makers[who]
    if user is not None:
        api_client.force_authenticate(user())
    resp = api_client.post(START, start_payload(), format="json")
    assert resp.status_code == 403 and resp.data["code"] == "public_start_disabled"
    assert not Registration.objects.exists()


@pytest.mark.parametrize("who", ["admin", "staff_admisiones"])
def test_staff_starts_and_fills_a_ficha_with_the_switch_off(api_client, who):
    api_client.force_authenticate(AdminFactory() if who == "admin" else staff("admisiones"))
    resp = api_client.post(START, start_payload(), format="json")
    assert resp.status_code == 201, resp.data
    reg_id, token = resp.data["id"], resp.data["session_token"]
    reg = Registration.objects.get(pk=reg_id)
    assert reg.status == "draft" and reg.pre_registration_id
    # The family gets its link to continue later.
    assert any(m.to == ["marta.ficha@ejemplo.test"] for m in mail.outbox)

    # Every step saves with the staff login and the ficha's session, health
    # included (the consent is in that same step).
    for section, builder in SECTION_DATA.items():
        saved = api_client.patch(
            reverse("register-ficha-section", args=[reg_id, section]),
            builder(),
            format="json",
            HTTP_X_SESSION_TOKEN=token,
        )
        assert saved.status_code == 200, (section, saved.data)
    ficha = api_client.get(reverse("register-ficha", args=[reg_id]), HTTP_X_SESSION_TOKEN=token)
    assert ficha.data["sections"]["salud"]["blood_type"] == "O+"


def test_without_the_session_an_admin_still_needs_the_consent(api_client):
    """The session is what opens health data; the login alone keeps the consent rule."""
    api_client.force_authenticate(AdminFactory())
    resp = api_client.post(START, start_payload(), format="json")
    reg_id = resp.data["id"]
    blocked = api_client.patch(
        reverse("register-ficha-section", args=[reg_id, "salud"]),
        salud_data(consent_medical_data=False),
        format="json",
    )
    assert blocked.status_code == 403 and blocked.data["code"] == "medical_forbidden"
