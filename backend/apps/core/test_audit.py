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
