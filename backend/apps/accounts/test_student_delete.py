"""
Removing a student: the `delete` bulk action refuses anyone with something to
keep and says why, only an admin may use it, and what it does remove leaves an
audit row. Also the `linked=missing` roster filter and the withdrawn-student
guards around it (paid top-ups on the warning list, no new top-ups).
"""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import StudentProfile, User
from apps.accounts.student_delete import deletion_blocker
from apps.cafeteria.models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    TopUpRequest,
)
from apps.core.models import AuditLog
from apps.legal.models import ConsentRecord, PrivacyNoticeVersion
from apps.payments.factories import PaymentFactory
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db

BULK = reverse("admin-student-bulk")
LIST = reverse("students")


def leaver(balance="0.00", **kwargs):
    """What the 35 in production look like: never signed in, customer gone from Loyverse."""
    kwargs.setdefault("loyverse_missing_since", timezone.now())
    student = StudentProfileFactory(**kwargs)
    student.parents.add(student.user)  # the Loyverse import makes them their own guardian
    CafeteriaBalance.objects.create(student=student, balance=Decimal(balance))
    return student


def _delete(client, ids, *, dry_run=False, confirm="ELIMINAR", **extra):
    body = {"action": "delete", "ids": list(ids), "dry_run": dry_run, **extra}
    if confirm is not None:
        body["payload"] = {"confirm": confirm}
    return client.post(BULK, body, format="json")


class TestDelete:
    def test_removes_the_login_the_profile_the_wallet_and_the_inbox(self, admin_client):
        student = leaver(grade="3° Secundaria", group="B", user__first_name="Ana", user__last_name="Ruiz")
        user_id, profile_id = student.user_id, student.id
        Notification.objects.create(user=student.user, title="Saldo bajo", message="-")

        resp = _delete(admin_client, [profile_id])

        assert resp.status_code == 200, resp.data
        assert resp.data["ok"] == 1 and not resp.data["skipped"] and not resp.data["failed"]
        assert not User.objects.filter(pk=user_id).exists()
        assert not StudentProfile.objects.filter(pk=profile_id).exists()
        assert not CafeteriaBalance.objects.filter(student_id=profile_id).exists()
        assert not Notification.objects.filter(user_id=user_id).exists()

    def test_the_audit_row_says_who_it_was_and_who_did_it(self, admin_client, admin_user):
        student = leaver(grade="3° Secundaria", group="B", user__first_name="Ana", user__last_name="Ruiz")
        profile_id, matricula = student.id, student.student_id

        _delete(admin_client, [profile_id])

        row = AuditLog.objects.get(
            action="delete", object_type="accounts.studentprofile", object_id=str(profile_id),
            changes__bulk="delete",
        )
        assert row.actor == admin_user
        assert row.changes["deleted"] == {
            "matricula": matricula, "name": "Ana Ruiz", "grade": "3° Secundaria", "group": "B",
        }

    def test_a_student_never_linked_to_loyverse_can_be_deleted(self, admin_client):
        student = leaver(loyverse_id="", loyverse_missing_since=None)
        assert _delete(admin_client, [student.id]).data["ok"] == 1

    def test_dry_run_plans_and_changes_nothing(self, admin_client):
        free = leaver()
        with_money = leaver(balance="10.00")

        resp = _delete(admin_client, [free.id, with_money.id], dry_run=True, confirm=None)

        assert resp.status_code == 200, resp.data
        assert resp.data["ok"] == 1
        assert resp.data["skipped"] == [{"id": with_money.id, "reason": "todavía tiene saldo en cafetería"}]
        assert StudentProfile.objects.filter(pk=free.id).exists()

    def test_a_mixed_selection_deletes_the_free_and_keeps_the_rest(self, admin_client):
        free, with_money = leaver(), leaver(balance="10.00")

        resp = _delete(admin_client, [free.id, with_money.id])

        assert resp.data["ok"] == 1 and len(resp.data["skipped"]) == 1
        assert not StudentProfile.objects.filter(pk=free.id).exists()
        with_money.refresh_from_db()
        assert with_money.status == "active"

    def test_works_on_everyone_matching_a_filter(self, admin_client):
        gone, kept = leaver(), StudentProfileFactory()

        resp = admin_client.post(BULK, {
            "action": "delete", "ids": [], "all_matching": True, "filters": {"linked": "missing"},
            "payload": {"confirm": "ELIMINAR"},
        }, format="json")

        assert resp.data["ok"] == 1, resp.data
        assert not StudentProfile.objects.filter(pk=gone.id).exists()
        assert StudentProfile.objects.filter(pk=kept.id).exists()


class TestRefusals:
    """Each one leaves the student untouched and names the reason."""

    def _refused(self, client, student, reason):
        assert deletion_blocker(student) == reason
        resp = _delete(client, [student.id])
        assert resp.status_code == 200, resp.data
        assert resp.data["ok"] == 0
        assert resp.data["skipped"] == [{"id": student.id, "reason": reason}]
        assert StudentProfile.objects.filter(pk=student.id).exists()
        assert User.objects.filter(pk=student.user_id).exists()
        assert CafeteriaBalance.objects.filter(student=student).exists()

    def test_has_signed_in(self, admin_client):
        student = leaver(user__last_login=timezone.now())
        self._refused(admin_client, student, "ya inició sesión en el portal")

    def test_still_in_loyverse_because_the_next_sync_would_recreate_it(self, admin_client):
        student = leaver(loyverse_missing_since=None)
        self._refused(admin_client, student, "sigue en Loyverse y la sincronización lo volvería a crear")

    @pytest.mark.parametrize("balance", ["0.01", "-5.00"])
    def test_wallet_not_at_zero(self, admin_client, balance):
        student = leaver(balance=balance)
        self._refused(admin_client, student, "todavía tiene saldo en cafetería")

    def test_has_a_guardian_with_an_own_account(self, admin_client):
        student = leaver()
        student.parents.add(ParentFactory())
        self._refused(admin_client, student, "tiene un tutor con cuenta propia")

    def test_is_the_guardian_of_a_sibling(self, admin_client):
        student = leaver()
        StudentProfileFactory(parents=[student.user])
        self._refused(admin_client, student, "es tutor de otro alumno")

    def test_account_is_not_a_student_login(self, admin_client):
        student = leaver(user=ParentFactory())
        self._refused(admin_client, student, "su cuenta no es de alumno")

    def test_purchase_history(self, admin_client):
        student = leaver()
        CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE, amount=Decimal("5.00"),
        )
        self._refused(admin_client, student, "tiene historial de compras, pagos o consentimientos")

    def test_top_up_history(self, admin_client):
        student = leaver()
        TopUpRequest.objects.create(student=student, amount=Decimal("100.00"))
        self._refused(admin_client, student, "tiene historial de compras, pagos o consentimientos")

    def test_balance_adjustment_history(self, admin_client, admin_user):
        student = leaver()
        BalanceAdjustment.objects.create(
            student=student, admin=admin_user, amount=Decimal("5.00"), reason="Corrección",
        )
        self._refused(admin_client, student, "tiene historial de compras, pagos o consentimientos")

    def test_a_payment_would_lose_its_owner(self, admin_client):
        student = leaver()
        PaymentFactory(user=student.user)
        self._refused(admin_client, student, "tiene historial de compras, pagos o consentimientos")

    def test_a_consent_about_the_student_would_lose_its_subject(self, admin_client):
        student = leaver()
        notice = PrivacyNoticeVersion.objects.create(version="t-1", body="-", effective_date=date(2026, 1, 1))
        ConsentRecord.objects.create(
            guardian=ParentFactory(), student=student, notice_version=notice, purpose="medical_data", granted=True,
        )
        self._refused(admin_client, student, "tiene historial de compras, pagos o consentimientos")

    def test_anything_the_rules_do_not_know_stops_it(self, admin_client):
        """Fails closed: a table added later is history until someone says otherwise."""
        student = leaver()
        with patch("apps.accounts.student_delete.DISPOSABLE", frozenset({"accounts.user"})):
            self._refused(admin_client, student, "tiene historial de compras, pagos o consentimientos")


class TestPermissions:
    def test_needs_the_typed_confirmation(self, admin_client):
        student = leaver()
        for confirm in (None, "eliminar", "SI"):
            resp = _delete(admin_client, [student.id], confirm=confirm)
            assert resp.status_code == 400, resp.data
        assert StudentProfile.objects.filter(pk=student.id).exists()

    def test_a_text_dry_run_flag_does_not_slip_past_the_confirmation(self, admin_client):
        student = leaver()
        resp = _delete(admin_client, [student.id], dry_run="false", confirm=None)
        assert resp.status_code == 400, resp.data
        assert StudentProfile.objects.filter(pk=student.id).exists()

    @pytest.mark.parametrize("dry_run", [True, False])
    def test_a_secretary_with_the_roster_area_cannot_delete(self, api_client, dry_run):
        api_client.force_authenticate(UserFactory(role=User.Role.STAFF, staff_areas=["alumnos"]))
        student = leaver()

        resp = _delete(api_client, [student.id], dry_run=dry_run)

        assert resp.status_code == 403
        assert StudentProfile.objects.filter(pk=student.id).exists()

    def test_the_same_secretary_can_still_archive(self, api_client):
        api_client.force_authenticate(UserFactory(role=User.Role.STAFF, staff_areas=["alumnos"]))
        student = leaver()

        resp = api_client.post(
            BULK, {"action": "status", "ids": [student.id], "payload": {"value": "withdrawn"}}, format="json",
        )

        assert resp.data["ok"] == 1, resp.data
        student.refresh_from_db()
        assert student.status == "withdrawn"


class TestMissingFilter:
    def test_lists_active_students_whose_customer_is_gone(self, admin_client):
        gone = leaver()
        leaver(status="withdrawn", is_active=False)
        StudentProfileFactory()

        for param in ("linked", "vinculado"):
            resp = admin_client.get(LIST, {param: "missing"})
            assert [r["id"] for r in resp.data["results"]] == [gone.id]

    def test_roster_rows_flag_them(self, admin_client):
        gone, here = leaver(), StudentProfileFactory()
        rows = {r["id"]: r for r in admin_client.get(LIST).data["results"]}
        assert rows[gone.id]["loyverse_missing_since"] is not None
        assert rows[here.id]["loyverse_missing_since"] is None


class TestArchivedStudents:
    def test_withdrawing_warns_about_a_paid_top_up_waiting_for_the_pos(self, admin_client):
        student = leaver()
        TopUpRequest.objects.create(student=student, amount=Decimal("200.00"), status=TopUpRequest.Status.PAID)

        resp = admin_client.post(BULK, {
            "action": "status", "ids": [student.id], "payload": {"value": "withdrawn"}, "dry_run": True,
        }, format="json")

        assert [w["balance"] for w in resp.data["warnings"]] == ["200.00"]
        assert "por aplicar" in resp.data["warnings"][0]["message"]

    def test_a_family_cannot_top_up_a_student_who_left(self, api_client):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent], status="withdrawn", is_active=False)
        api_client.force_authenticate(parent)

        resp = api_client.post(
            reverse("cafeteria-topup"), {"student": student.id, "amount": "100.00", "method": "online"}, format="json",
        )

        assert resp.status_code == 400, resp.data
        assert resp.data["code"] == "student_inactive"
        assert not TopUpRequest.objects.filter(student=student).exists()
