"""
Taking a student off the platform (owner, 2026-11-08).

``delete`` erases a record with nothing to keep and archives everyone else, and
the response counts both; ``archive`` and ``restore`` move a student off and
back on the lists with the history intact. Only an admin may delete; the
roster area may archive and restore. Also: the ``linked=missing`` filter, the
duplicate check on create, the student's history and the top-up guard.
"""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.factories import ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import StudentProfile, User
from apps.accounts.student_delete import keep_reason
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
CREATE = reverse("admin-student-create")


def leaver(balance="0.00", **kwargs):
    """What the 35 in production look like: never signed in, customer gone from Loyverse."""
    kwargs.setdefault("loyverse_missing_since", timezone.now())
    student = StudentProfileFactory(**kwargs)
    student.parents.add(student.user)  # the Loyverse import makes them their own guardian
    CafeteriaBalance.objects.create(student=student, balance=Decimal(balance))
    return student


def _bulk(client, action, ids, *, dry_run=False, **extra):
    body = {"action": action, "ids": list(ids), "dry_run": dry_run, **extra}
    if action == "delete" and "payload" not in body:
        body["payload"] = {"confirm": "ELIMINAR"}
    return client.post(BULK, body, format="json")


def _archived(student) -> bool:
    student.refresh_from_db()
    student.user.refresh_from_db()
    return student.user.archived_at is not None


def _listed_ids(client, **params):
    return [r["id"] for r in client.get(LIST, params).data["results"]]


class TestDelete:
    def test_a_record_with_nothing_to_keep_is_erased_with_its_login_wallet_and_inbox(self, admin_client):
        student = leaver(grade="3° Secundaria", group="B", user__first_name="Ana", user__last_name="Ruiz")
        user_id, profile_id = student.user_id, student.id
        Notification.objects.create(user=student.user, title="Saldo bajo", message="-")

        resp = _bulk(admin_client, "delete", [profile_id])

        assert resp.status_code == 200, resp.data
        assert resp.data["ok"] == 1 and resp.data["outcomes"] == {"erased": 1}
        assert not User.objects.filter(pk=user_id).exists()
        assert not StudentProfile.objects.filter(pk=profile_id).exists()
        assert not CafeteriaBalance.objects.filter(student_id=profile_id).exists()
        assert not Notification.objects.filter(user_id=user_id).exists()

    def test_the_audit_row_keeps_who_was_erased_and_who_did_it(self, admin_client, admin_user):
        student = leaver(grade="3° Secundaria", group="B", user__first_name="Ana", user__last_name="Ruiz")
        profile_id, matricula = student.id, student.student_id

        _bulk(admin_client, "delete", [profile_id])

        row = AuditLog.objects.get(
            action="delete", object_type="accounts.studentprofile", object_id=str(profile_id),
            changes__bulk="delete",
        )
        assert row.actor == admin_user
        assert row.changes["outcome"] == "erased"
        assert row.changes["deleted"] == {
            "matricula": matricula, "name": "Ana Ruiz", "grade": "3° Secundaria", "group": "B",
        }

    def test_anyone_with_something_to_keep_is_archived_not_refused(self, admin_client):
        student = leaver(balance="100.00")

        resp = _bulk(admin_client, "delete", [student.id])

        assert resp.data["ok"] == 1 and resp.data["outcomes"] == {"archived": 1}, resp.data
        assert _archived(student)
        assert student.status == "withdrawn" and not student.is_active and not student.user.is_active
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("100.00")
        row = AuditLog.objects.get(action="delete", object_id=str(student.id), changes__bulk="delete")
        assert row.changes["outcome"] == "archived" and row.changes["reason"] == "tiene saldo en cafetería"

    def test_the_plan_says_how_many_go_each_way_and_changes_nothing(self, admin_client):
        free, with_money = leaver(), leaver(balance="10.00")

        resp = _bulk(admin_client, "delete", [free.id, with_money.id], dry_run=True, payload={})

        assert resp.status_code == 200, resp.data
        assert resp.data["outcomes"] == {"erased": 1, "archived": 1}
        assert [w["balance"] for w in resp.data["warnings"]] == ["10.00"]
        assert StudentProfile.objects.filter(pk=free.id).exists()
        assert not _archived(with_money)

    def test_a_mixed_selection_erases_the_free_and_archives_the_rest(self, admin_client):
        free, with_money = leaver(), leaver(balance="10.00")

        resp = _bulk(admin_client, "delete", [free.id, with_money.id])

        assert resp.data["outcomes"] == {"erased": 1, "archived": 1}
        assert not StudentProfile.objects.filter(pk=free.id).exists()
        assert _archived(with_money)

    def test_works_on_everyone_matching_a_filter(self, admin_client):
        gone, kept = leaver(), StudentProfileFactory()

        resp = admin_client.post(BULK, {
            "action": "delete", "ids": [], "all_matching": True, "filters": {"linked": "missing"},
            "payload": {"confirm": "ELIMINAR"},
        }, format="json")

        assert resp.data["ok"] == 1, resp.data
        assert not StudentProfile.objects.filter(pk=gone.id).exists()
        assert StudentProfile.objects.filter(pk=kept.id).exists()

    def test_an_archived_record_with_nothing_to_keep_can_still_be_erased(self, admin_client):
        student = leaver()
        _bulk(admin_client, "archive", [student.id])

        resp = _bulk(admin_client, "delete", [student.id])

        assert resp.data["outcomes"] == {"erased": 1}, resp.data
        assert not StudentProfile.objects.filter(pk=student.id).exists()

    def test_an_archived_record_with_history_is_left_as_it_is(self, admin_client):
        student = leaver(balance="5.00")
        _bulk(admin_client, "archive", [student.id])

        resp = _bulk(admin_client, "delete", [student.id])

        assert resp.data["ok"] == 0
        assert resp.data["skipped"] == [{"id": student.id, "reason": "ya está archivado"}]

    def test_a_tutors_login_attached_to_a_file_is_not_touched(self, admin_client):
        student = leaver(user=ParentFactory())

        resp = _bulk(admin_client, "delete", [student.id])

        assert resp.data["ok"] == 0
        assert resp.data["skipped"][0]["reason"].startswith("su cuenta no es de alumno")
        assert User.objects.filter(pk=student.user_id, archived_at__isnull=True).exists()


class TestWhatMakesAStudentArchiveInsteadOfErase:
    """Each one archives the student (history intact) and records why."""

    def _archives(self, client, student, reason):
        assert keep_reason(student) == reason
        resp = _bulk(client, "delete", [student.id])
        assert resp.data["outcomes"] == {"archived": 1}, resp.data
        assert _archived(student)
        assert User.objects.filter(pk=student.user_id).exists()

    def test_signed_in(self, admin_client):
        self._archives(admin_client, leaver(user__last_login=timezone.now()), "ya inició sesión en el portal")

    def test_still_in_loyverse(self, admin_client):
        self._archives(admin_client, leaver(loyverse_missing_since=None), "sigue en Loyverse")

    @pytest.mark.parametrize("balance", ["0.01", "-5.00"])
    def test_wallet_not_at_zero(self, admin_client, balance):
        self._archives(admin_client, leaver(balance=balance), "tiene saldo en cafetería")

    def test_has_a_tutor_with_an_own_account(self, admin_client):
        student = leaver()
        student.parents.add(ParentFactory())
        self._archives(admin_client, student, "tiene un tutor con cuenta propia")

    def test_is_the_guardian_of_a_sibling(self, admin_client):
        student = leaver()
        StudentProfileFactory(parents=[student.user])
        self._archives(admin_client, student, "es tutor de otro alumno")

    def test_purchases(self, admin_client):
        student = leaver()
        CafeteriaTransaction.objects.create(
            student=student, transaction_type=CafeteriaTransaction.TxType.PURCHASE, amount=Decimal("5.00"),
        )
        self._archives(admin_client, student, "tiene compras, pagos o actividad")

    def test_top_ups(self, admin_client):
        student = leaver()
        TopUpRequest.objects.create(student=student, amount=Decimal("100.00"))
        self._archives(admin_client, student, "tiene compras, pagos o actividad")

    def test_balance_adjustments(self, admin_client, admin_user):
        student = leaver()
        BalanceAdjustment.objects.create(student=student, admin=admin_user, amount=Decimal("5.00"), reason="Ajuste")
        self._archives(admin_client, student, "tiene compras, pagos o actividad")

    def test_a_payment(self, admin_client):
        student = leaver()
        PaymentFactory(user=student.user)
        self._archives(admin_client, student, "tiene compras, pagos o actividad")

    def test_a_consent(self, admin_client):
        student = leaver()
        notice = PrivacyNoticeVersion.objects.create(version="t-1", body="-", effective_date=date(2026, 1, 1))
        ConsentRecord.objects.create(
            guardian=ParentFactory(), student=student, notice_version=notice, purpose="medical_data", granted=True,
        )
        self._archives(admin_client, student, "tiene compras, pagos o actividad")

    def test_a_past_session(self, admin_client):
        student = leaver()
        RefreshToken.for_user(student.user)
        self._archives(admin_client, student, "tiene compras, pagos o actividad")

    def test_anything_the_rules_do_not_know(self, admin_client):
        """Fails closed: a table added later is history until someone says otherwise."""
        student = leaver()
        with patch("apps.accounts.account_removal.DISPOSABLE", frozenset({"accounts.user"})):
            self._archives(admin_client, student, "tiene compras, pagos o actividad")


class TestArchiveAndRestore:
    def test_archive_takes_the_student_off_every_list_and_ends_their_sessions(self, admin_client):
        student = leaver(balance="40.00", loyverse_missing_since=None)
        token = RefreshToken.for_user(student.user)

        resp = _bulk(admin_client, "archive", [student.id])

        assert resp.data["outcomes"] == {"archived": 1}, resp.data
        assert _archived(student) and student.status == "withdrawn" and not student.user.is_active
        assert BlacklistedToken.objects.filter(token__jti=token["jti"]).exists()
        assert student.id not in _listed_ids(admin_client)
        assert student.id not in _listed_ids(admin_client, status="withdrawn")
        assert _listed_ids(admin_client, archived="1") == [student.id]
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal("40.00")

    def test_restore_brings_them_back_as_baja_definitiva(self, admin_client):
        student = leaver()
        _bulk(admin_client, "archive", [student.id])

        resp = _bulk(admin_client, "restore", [student.id])

        assert resp.data["outcomes"] == {"restored": 1}, resp.data
        assert not _archived(student)
        assert student.status == "withdrawn" and not student.user.is_active
        assert student.id in _listed_ids(admin_client, status="withdrawn")

    def test_archiving_twice_or_restoring_a_listed_student_is_skipped(self, admin_client):
        listed, archived = leaver(), leaver()
        _bulk(admin_client, "archive", [archived.id])

        assert _bulk(admin_client, "archive", [archived.id]).data["skipped"][0]["reason"] == "ya está archivado"
        assert _bulk(admin_client, "restore", [listed.id]).data["skipped"][0]["reason"] == "no está archivado"

    def test_exports_leave_archived_students_out(self, admin_client):
        archived, listed = leaver(), StudentProfileFactory()
        _bulk(admin_client, "archive", [archived.id])

        resp = admin_client.get(reverse("export-students"), {"fmt": "csv"})

        body = b"".join(resp.streaming_content) if resp.streaming else resp.content
        assert listed.student_id.encode() in body
        assert archived.student_id.encode() not in body


class TestPermissions:
    def test_delete_needs_the_confirmation_the_console_sends(self, admin_client):
        student = leaver()
        for payload in ({}, {"confirm": "eliminar"}, {"confirm": "SI"}):
            resp = _bulk(admin_client, "delete", [student.id], payload=payload)
            assert resp.status_code == 400, resp.data
        assert StudentProfile.objects.filter(pk=student.id).exists()

    def test_a_text_dry_run_flag_does_not_slip_past_the_confirmation(self, admin_client):
        student = leaver()
        resp = _bulk(admin_client, "delete", [student.id], dry_run="false", payload={})
        assert resp.status_code == 400, resp.data

    @pytest.mark.parametrize("dry_run", [True, False])
    def test_the_roster_area_cannot_delete(self, api_client, dry_run):
        api_client.force_authenticate(UserFactory(role=User.Role.STAFF, staff_areas=["alumnos"]))
        student = leaver()

        assert _bulk(api_client, "delete", [student.id], dry_run=dry_run).status_code == 403
        assert StudentProfile.objects.filter(pk=student.id).exists()

    def test_the_roster_area_can_archive_and_restore(self, api_client):
        api_client.force_authenticate(UserFactory(role=User.Role.STAFF, staff_areas=["alumnos"]))
        student = leaver()

        assert _bulk(api_client, "archive", [student.id]).data["ok"] == 1
        assert _bulk(api_client, "restore", [student.id]).data["ok"] == 1
        assert not _archived(student)


class TestHistory:
    def test_lists_changes_to_the_file_and_its_login_newest_first(self, admin_client):
        student = StudentProfileFactory(grade="1° Primaria")
        admin_client.patch(reverse("admin-student-update", args=[student.id]), {"grade": "2° Primaria"}, format="json")
        _bulk(admin_client, "archive", [student.id])

        resp = admin_client.get(reverse("admin-student-history", args=[student.id]))

        assert resp.status_code == 200
        types = {r["object_type"] for r in resp.data}
        assert types == {"accounts.studentprofile", "accounts.user"}
        stamps = [r["created_at"] for r in resp.data]
        assert stamps == sorted(stamps, reverse=True)

    def test_unknown_student_is_404(self, admin_client):
        assert admin_client.get(reverse("admin-student-history", args=[999999])).status_code == 404


class TestDuplicateOnCreate:
    BODY = {"first_name": "Ana", "last_name": "Ruiz", "grade": "1° Primaria"}

    def test_points_to_the_record_that_already_has_the_matricula(self, admin_client):
        existing = StudentProfileFactory(student_id="09111", user__first_name="Ana", user__last_name="Ruiz")

        resp = admin_client.post(CREATE, {**self.BODY, "student_id": "09111"}, format="json")

        assert resp.status_code == 400
        assert resp.data["existing"] == {
            "id": existing.id, "name": "Ana Ruiz", "student_id": "09111", "status": "active", "archived": False,
        }

    def test_says_when_that_record_is_archived(self, admin_client):
        existing = leaver(student_id="09112")
        _bulk(admin_client, "archive", [existing.id])

        resp = admin_client.post(CREATE, {**self.BODY, "student_id": "09112"}, format="json")

        assert resp.data["existing"]["archived"] is True


class TestMissingFilter:
    def test_lists_active_students_whose_customer_is_gone(self, admin_client):
        gone = leaver()
        leaver(status="withdrawn", is_active=False)
        StudentProfileFactory()

        for param in ("linked", "vinculado"):
            assert _listed_ids(admin_client, **{param: "missing"}) == [gone.id]

    def test_roster_rows_flag_them(self, admin_client):
        gone, here = leaver(), StudentProfileFactory()
        rows = {r["id"]: r for r in admin_client.get(LIST).data["results"]}
        assert rows[gone.id]["loyverse_missing_since"] is not None
        assert rows[here.id]["loyverse_missing_since"] is None


class TestLeavingStudents:
    def test_a_withdrawal_warns_about_a_paid_top_up_waiting_for_the_pos(self, admin_client):
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
