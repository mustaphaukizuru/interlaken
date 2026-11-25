"""QA 2026-11-24: phone and WhatsApp fields accepted letters.

One rule (core.phones): digits plus +, spaces, dashes and parentheses, 10 to
15 digits. The value is kept as typed; a value the record already holds is
always accepted, so a number saved before the rule never blocks a save.
"""

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import serializers

from apps.accounts.factories import AdminFactory
from apps.core.phones import MSG_PHONE_CHARS, MSG_PHONE_LENGTH, check_phone, phone_problem

CHARS = "Escriba solo números; puede usar espacios, guiones, paréntesis y el signo +."
LENGTH = "El número debe tener de 10 a 15 dígitos."


@pytest.mark.parametrize(
    "value",
    [
        "5512345678",
        "55 1234 5678",
        "(55) 1234-5678",
        "+52 55 1234 5678",
        "+52 1 55 1234 5678",
        "521551234567890",
        "",
        "   ",
    ],
)
def test_accepted(value):
    assert phone_problem(value) is None


@pytest.mark.parametrize(
    "value, message",
    [
        ("55 1234 abcd", CHARS),
        ("5512345678 ext 2", CHARS),
        ("55.1234.5678", CHARS),
        ("55/1234/5678", CHARS),
        ("551234567", LENGTH),
        ("5521551234567890", LENGTH),
        ("+", LENGTH),
        ("(  )", LENGTH),
    ],
)
def test_refused_with_a_plain_message(value, message):
    assert phone_problem(value) == message


def test_messages():
    assert (MSG_PHONE_CHARS, MSG_PHONE_LENGTH) == (CHARS, LENGTH)


def test_check_phone_trims_and_keeps_the_stored_value():
    assert check_phone("  55 1234 5678 ") == "55 1234 5678"
    assert check_phone("55 ext 1", current="55 ext 1") == "55 ext 1"  # unchanged legacy value
    assert check_phone(" 55 ext 1 ", current="55 ext 1") == "55 ext 1"
    with pytest.raises(serializers.ValidationError):
        check_phone("55 ext 2", current="55 ext 1")  # a change follows the rule
    assert check_phone("", current="55 ext 1") == ""  # clearing is allowed


@pytest.mark.django_db
class TestPublicForms:
    @pytest.fixture(autouse=True)
    def _no_ratelimit(self, settings):
        settings.RATELIMIT_ENABLE = False

    def test_booking_refuses_letters(self, api_client):
        from datetime import timedelta

        from apps.bookings.models import AvailabilitySlot, Booking

        day = timezone.localdate() + timedelta(days=3)
        slot = AvailabilitySlot.objects.create(
            date=day, start_time="10:00", end_time="10:30", capacity=2
        )
        body = {
            "slot": slot.id,
            "parent_name": "Ana López",
            "parent_email": "ana@test.mx",
            "num_attendees": 1,
        }
        resp = api_client.post(
            reverse("bookings-create"), {**body, "parent_phone": "55 1234 abcd"}, format="json"
        )
        assert resp.status_code == 400 and resp.data["parent_phone"] == [CHARS]
        assert not Booking.objects.exists()

    def test_pre_registration_refuses_letters(self, api_client):
        year = timezone.localdate().year
        resp = api_client.post(
            reverse("pre-register"),
            {
                "child_name": "Ana Pérez",
                "child_dob": f"{year - 6}-03-15",
                "grade_applying": "Primaria 1°",
                "parent_name": "Luis Pérez",
                "email": "luis@test.mx",
                "phone": "cincuenta y cinco",
            },
            format="json",
        )
        assert resp.status_code == 400 and resp.data["phone"] == [CHARS]

    def test_facturacion_refuses_letters(self, api_client):
        body = {
            "student": "Ana Pérez López",
            "razon_social": "Luis Pérez",
            "rfc": "PELU800101AB1",
            "cp": "54000",
            "regimen": "Régimen simplificado de confianza",
            "email": "luis@test.mx",
        }
        resp = api_client.post(
            reverse("facturacion-request"), {**body, "phone": "55 1234 567a"}, format="json"
        )
        assert resp.status_code == 400 and resp.data["phone"] == [CHARS]
        resp = api_client.post(
            reverse("facturacion-request"),
            {**body, "email": "luis@", "phone": "5512345678"},
            format="json",
        )
        assert resp.status_code == 400 and resp.data["email"] == ["Revise el correo."]

    def test_cms_form_phone_field(self, api_client):
        from apps.content.forms import FormDefinition

        FormDefinition.objects.create(
            slug="informes-verano",
            title="Informes",
            is_published=True,
            consent_text="",
            fields=[{"key": "tel", "label": "Teléfono", "type": "phone", "required": True}],
        )
        url = reverse("cms-form-submit", args=["informes-verano"])
        resp = api_client.post(url, {"tel": "55 1234 abcd"}, format="json")
        assert resp.status_code == 400 and "tel" in str(resp.data)
        assert CHARS in str(resp.data)
        assert api_client.post(url, {"tel": "(55) 1234-5678"}, format="json").status_code in (
            200,
            201,
        )


@pytest.mark.django_db
class TestSiteSettings:
    def test_whatsapp_and_dial_numbers_follow_the_rule_but_keep_a_stored_value(self, api_client):
        from apps.content.models import SiteSettings

        s = SiteSettings.load()
        s.whatsapp_number = "52 155 ext"  # saved before the rule
        s.save()
        api_client.force_authenticate(AdminFactory())
        url = reverse("admin-site-settings")
        resp = api_client.patch(
            url, {"whatsapp_number": "52 155 ext", "phone_display": "(55) 5379-1188"}, format="json"
        )
        assert resp.status_code == 200, resp.data
        resp = api_client.patch(url, {"whatsapp_number": "52155537911xx"}, format="json")
        assert resp.status_code == 400 and resp.data["whatsapp_number"] == [CHARS]
        resp = api_client.patch(url, {"phone_e164": "+52 55"}, format="json")
        assert resp.status_code == 400 and resp.data["phone_e164"] == [LENGTH]
        resp = api_client.patch(
            url, {"whatsapp_number": "5215553791188", "phone_e164": "+525553791188"}, format="json"
        )
        assert resp.status_code == 200, resp.data


@pytest.mark.django_db
def test_staff_user_without_email_is_asked_for_it(api_client):
    api_client.force_authenticate(AdminFactory())
    url = reverse("admin-staff")
    resp = api_client.post(url, {"email": "", "first_name": "Ana"}, format="json")
    assert resp.status_code == 400 and resp.data["email"] == ["Escriba el correo."]
    resp = api_client.post(url, {"email": "ana.test.mx", "first_name": "Ana"}, format="json")
    assert resp.status_code == 400 and resp.data["email"] == ["Revise el correo."]
