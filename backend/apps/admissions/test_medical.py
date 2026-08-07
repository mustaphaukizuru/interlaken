"""
Medical-data enforcement (IK-LEGAL B4): encrypted at rest, decrypted on read, and
serializer-gated on role + MEDICAL_DATA consent. Plus the retention report.
"""
from io import StringIO

import pytest
from django.core.management import call_command
from django.db import connection
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.admissions.models import Registration

pytestmark = pytest.mark.django_db

BASE = {
    "child_first_name": "Niño", "child_last_name": "Prueba", "child_dob": "2018-05-01",
    "level": "primaria", "grade_applying": "1° Primaria",
    "parent1_name": "Madre", "parent1_email": "madre@test.mx", "parent1_phone": "5512345678",
}


def _session(api_client):
    created = api_client.post(reverse("register-create"), BASE, format="json")
    reg_id, invite = created.data["id"], created.data["invite_token"]
    token = api_client.post(reverse("register-access", args=[reg_id]),
                            {"token": invite}, format="json").data["session_token"]
    return reg_id, token


class TestEncryptionAtRest:
    def test_medical_value_is_ciphertext_in_db_but_plaintext_via_orm(self):
        reg = Registration.objects.create(**BASE, blood_type="O+", allergies="Penicilina")
        # Raw DB bytes are NOT the plaintext.
        with connection.cursor() as cur:
            cur.execute("SELECT blood_type, allergies FROM admissions_registration WHERE id=%s",
                        [reg.id])
            raw_blood, raw_allergies = cur.fetchone()
        assert raw_blood not in (None, "", "O+")
        assert "Penicilina" not in (raw_allergies or "")
        # The ORM transparently decrypts.
        fresh = Registration.objects.get(pk=reg.id)
        assert fresh.blood_type == "O+"
        assert fresh.allergies == "Penicilina"


class TestMedicalGate:
    def test_owner_with_session_can_read_medical(self, api_client):
        reg_id, token = _session(api_client)
        reg = Registration.objects.get(pk=reg_id)
        reg.blood_type = "A-"
        reg.save()
        resp = api_client.get(reverse("register-detail", args=[reg_id]),
                              HTTP_X_SESSION_TOKEN=token)
        assert resp.status_code == 200
        assert resp.data["blood_type"] == "A-"

    def test_staff_without_medical_consent_gets_masked(self, api_client):
        reg = Registration.objects.create(**BASE, blood_type="B+", consent_medical_data=False)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("register-detail", args=[reg.id]))
        assert resp.status_code == 200
        assert resp.data["blood_type"] is None  # masked (no consent)

    def test_staff_with_medical_consent_can_read(self, api_client):
        reg = Registration.objects.create(**BASE, blood_type="B+", consent_medical_data=True)
        api_client.force_authenticate(user=AdminFactory())
        resp = api_client.get(reverse("register-detail", args=[reg.id]))
        assert resp.status_code == 200
        assert resp.data["blood_type"] == "B+"


class TestRetentionReport:
    def test_report_lists_but_never_deletes(self):
        rejected = Registration.objects.create(**BASE, status=Registration.Status.REJECTED)
        # Force it past the window.
        Registration.objects.filter(pk=rejected.id).update(
            updated_at="2000-01-01T00:00:00Z")
        out = StringIO()
        call_command("report_retention", stdout=out)
        text = out.getvalue()
        assert "REPORT ONLY" in text
        assert Registration.objects.filter(pk=rejected.id).exists()  # not deleted
