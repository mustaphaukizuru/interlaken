"""
Append-only audit log (IK-SEC A3): immutability, automated (webhook) money
attribution, and minor-data / role-change diffs.
"""
import hashlib
import hmac
import json
from decimal import Decimal

import pytest
from django.db import IntegrityError
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.accounts.models import User
from apps.cafeteria.models import TopUpRequest
from apps.core.audit import audit_context, record
from apps.core.models import AuditLog
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

SECRET = "test-webhook-secret"


def _logs_for(instance):
    return AuditLog.objects.filter(
        object_type=f"{instance._meta.app_label}.{instance._meta.model_name}",
        object_id=str(instance.pk),
    )


class TestAppendOnly:
    def test_instance_update_and_delete_raise(self):
        student = StudentProfileFactory()
        record("update", student, {"grade": ["1", "2"]}, actor_label="system:test")
        entry = AuditLog.objects.latest("created_at")

        entry.action = "delete"
        with pytest.raises(IntegrityError):
            entry.save()
        with pytest.raises(IntegrityError):
            entry.delete()

    def test_queryset_update_and_delete_raise(self):
        student = StudentProfileFactory()
        record("update", student, {"grade": ["1", "2"]}, actor_label="system:test")
        with pytest.raises(IntegrityError):
            AuditLog.objects.all().update(action="delete")
        with pytest.raises(IntegrityError):
            AuditLog.objects.all().delete()


class TestAutomatedMoneyAttribution:
    def test_webhook_payment_logs_as_system_webhook(self, api_client, settings):
        settings.GLOBAL_PAYMENTS_WEBHOOK_SECRET = SECRET
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal("200.00"), method=TopUpRequest.Method.ONLINE,
        )
        payment = Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal("200.00"),
            gateway=Payment.Gateway.GLOBAL_PAYMENTS, related_topup=topup,
            status=Payment.Status.PENDING,
        )

        body = json.dumps({"order_id": payment.id, "status": "CAPTURED", "id": "gp-1"}).encode()
        sig = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        resp = api_client.post(reverse("payment-webhook"), data=body,
                               content_type="application/json", HTTP_X_WEBHOOK_SIGNATURE=sig)
        assert resp.status_code == 200, resp.data

        # The pending→success transition is audited as an automated system action.
        entry = _logs_for(payment).filter(action="update").latest("created_at")
        assert entry.actor is None
        assert entry.actor_label == "system:webhook"
        assert "status" in entry.changes


class TestMinorAndRoleDiffs:
    def test_student_personal_edit_logs_a_diff(self):
        student = StudentProfileFactory(grade="1° Primaria")
        before = _logs_for(student).filter(action="update").count()

        student.grade = "2° Primaria"
        student.save()

        entry = _logs_for(student).filter(action="update").latest("created_at")
        assert _logs_for(student).filter(action="update").count() == before + 1
        assert entry.changes["grade"] == ["1° Primaria", "2° Primaria"]

    def test_role_change_is_audited(self):
        user = ParentFactory()
        user.role = User.Role.ADMIN
        user.save()
        entry = _logs_for(user).filter(action="update").latest("created_at")
        assert entry.changes["role"] == ["parent", "admin"]
        assert entry.context == "account.permission"

    def test_explicit_actor_is_recorded(self):
        admin = AdminFactory()
        student = StudentProfileFactory()
        with audit_context(actor=admin, context="admin.console"):
            record("update", student, {"is_active": [True, False]})
        entry = _logs_for(student).latest("created_at")
        assert entry.actor_id == admin.id
        assert entry.actor_label == admin.email


class TestMedicalRedaction:
    """PHI (encrypted medical fields) must never land in the plain audit log —
    the diff records that a change happened, never the value (IK-LEGAL B4)."""

    BASE = {
        "child_first_name": "Niño", "child_last_name": "Prueba", "child_dob": "2018-05-01",
        "level": "primaria", "grade_applying": "1° Primaria",
        "parent1_name": "Madre", "parent1_email": "madre@test.mx", "parent1_phone": "5512345678",
    }

    def test_create_redacts_medical_values(self):
        from apps.admissions.models import Registration
        reg = Registration.objects.create(**self.BASE, blood_type="O+", allergies="Penicilina")
        entry = _logs_for(reg).filter(action="create").latest("created_at")
        assert entry.changes["blood_type"] == [None, "[redacted]"]
        assert entry.changes["allergies"] == [None, "[redacted]"]
        blob = json.dumps(entry.changes)
        assert "O+" not in blob and "Penicilina" not in blob

    def test_update_redacts_both_sides(self):
        from apps.admissions.models import Registration
        reg = Registration.objects.create(**self.BASE, blood_type="O+")
        reg.blood_type = "A-"
        reg.save()
        entry = _logs_for(reg).filter(action="update").latest("created_at")
        assert entry.changes["blood_type"] == ["[redacted]", "[redacted]"]
        blob = json.dumps(entry.changes)
        assert "O+" not in blob and "A-" not in blob
