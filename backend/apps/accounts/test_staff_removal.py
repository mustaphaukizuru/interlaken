"""
Usuarios (owner, 2026-11-08): archive, restore and delete staff and admin
accounts with the same guards as deactivation, edit their name and email, and
see what each account did. An archived or deactivated account gets no Google
session either.
"""

from unittest.mock import patch

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import User
from apps.core.audit import record
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db

BULK = reverse("admin-staff-bulk")
LIST = reverse("admin-staff")


@pytest.fixture
def me(api_client):
    admin = AdminFactory(email="yo@x.mx", password=None)
    api_client.force_authenticate(admin)
    return api_client, admin


def teacher(**kwargs):
    kwargs.setdefault("role", User.Role.STAFF)
    kwargs.setdefault("password", None)
    return UserFactory(**kwargs)


def _bulk(client, action, ids, *, dry_run=False, **extra):
    body = {"action": action, "ids": list(ids), "dry_run": dry_run, **extra}
    if action == "delete" and "payload" not in body:
        body["payload"] = {"confirm": "ELIMINAR"}
    return client.post(BULK, body, format="json")


def _emails(client, **params):
    return sorted(r["email"] for r in client.get(LIST, params).data["results"])


class TestArchive:
    def test_takes_the_account_off_the_list_and_ends_its_sessions(self, me):
        client, _ = me
        t = teacher(email="t@x.mx")
        token = RefreshToken.for_user(t)

        resp = _bulk(client, "archive", [t.id])

        assert resp.data["outcomes"] == {"archived": 1}, resp.data
        t.refresh_from_db()
        assert t.archived_at is not None and not t.is_active
        assert BlacklistedToken.objects.filter(token__jti=token["jti"]).exists()
        assert "t@x.mx" not in _emails(client)
        assert "t@x.mx" not in _emails(client, activo="0")
        assert _emails(client, activo="archivadas") == ["t@x.mx"]

    def test_restore_lets_the_person_sign_in_again(self, me):
        client, _ = me
        t = teacher()
        _bulk(client, "archive", [t.id])

        assert _bulk(client, "restore", [t.id]).data["outcomes"] == {"restored": 1}
        t.refresh_from_db()
        assert t.archived_at is None and t.is_active


class TestDelete:
    def test_an_invited_account_never_used_is_erased(self, me):
        client, admin = me
        t = teacher(email="nueva@x.mx", first_name="Nueva", last_name="Cuenta")
        pk = t.pk

        resp = _bulk(client, "delete", [pk])

        assert resp.data["outcomes"] == {"erased": 1}, resp.data
        assert not User.objects.filter(pk=pk).exists()
        row = AuditLog.objects.get(action="delete", object_type="accounts.user", object_id=str(pk),
                                   changes__bulk="delete")
        assert row.actor == admin
        assert row.changes["deleted"] == {"email": "nueva@x.mx", "name": "Nueva Cuenta", "role": "staff"}

    @pytest.mark.parametrize("history", ["signed_in", "acted"])
    def test_an_account_with_history_is_archived(self, me, history):
        client, _ = me
        t = teacher()
        if history == "signed_in":
            User.objects.filter(pk=t.pk).update(last_login=timezone.now())
        else:
            record("update", t, {"x": [1, 2]}, actor=t, context="test")

        resp = _bulk(client, "delete", [t.id])

        assert resp.data["outcomes"] == {"archived": 1}, resp.data
        assert User.objects.filter(pk=t.pk, archived_at__isnull=False).exists()

    def test_the_plan_counts_both_and_changes_nothing(self, me):
        client, _ = me
        fresh, used = teacher(), teacher(last_login=timezone.now())

        resp = _bulk(client, "delete", [fresh.id, used.id], dry_run=True, payload={})

        assert resp.data["outcomes"] == {"erased": 1, "archived": 1}, resp.data
        assert User.objects.filter(pk=fresh.pk).exists()

    def test_needs_the_confirmation(self, me):
        client, _ = me
        t = teacher()
        assert _bulk(client, "delete", [t.id], payload={}).status_code == 400
        assert User.objects.filter(pk=t.pk).exists()


class TestGuards:
    @pytest.mark.parametrize("action", ["archive", "delete"])
    def test_not_your_own_account(self, me, action):
        client, admin = me
        resp = _bulk(client, action, [admin.id])
        assert resp.data["skipped"] == [{"id": admin.id, "reason": "es su propia cuenta"}]

    @pytest.mark.parametrize("action", ["archive", "delete"])
    def test_not_the_superuser_or_a_family_account(self, me, action):
        client, _ = me
        boss = UserFactory(role=User.Role.ADMIN, is_superuser=True, password=None)
        parent = ParentFactory()
        resp = _bulk(client, action, [boss.id, parent.id])
        assert resp.data["ok"] == 0 and len(resp.data["skipped"]) == 2

    def test_the_last_active_admin_stays(self, api_client):
        """Defense in depth: normally the actor is the other active admin, so this
        only bites if the acting account was deactivated meanwhile."""
        only_admin = AdminFactory(password=None)
        api_client.force_authenticate(AdminFactory(password=None, is_active=False))

        resp = _bulk(api_client, "archive", [only_admin.id])

        assert resp.data["ok"] == 0 and resp.data["failed"], resp.data
        assert User.objects.get(pk=only_admin.pk).archived_at is None

    def test_staff_cannot_use_it(self, api_client):
        api_client.force_authenticate(teacher(staff_areas=["alumnos"]))
        assert _bulk(api_client, "archive", [teacher().id]).status_code == 403


class TestEdit:
    def url(self, user):
        return reverse("admin-staff-detail", args=[user.id])

    def test_changes_name_and_email(self, me):
        client, _ = me
        t = teacher(email="old@x.mx")

        resp = client.patch(self.url(t), {"first_name": "Laura", "last_name": "Mtz", "email": " Nueva@X.mx "},
                            format="json")

        assert resp.status_code == 200, resp.data
        t.refresh_from_db()
        assert (t.first_name, t.last_name, t.email) == ("Laura", "Mtz", "nueva@x.mx")
        row = AuditLog.objects.filter(object_type="accounts.user", object_id=str(t.id)).latest("id")
        assert row.changes["email"] == {"from": "old@x.mx", "to": "nueva@x.mx"}

    @pytest.mark.parametrize("email", ["no-es-correo", ""])
    def test_refuses_an_invalid_email(self, me, email):
        client, _ = me
        assert client.patch(self.url(teacher()), {"email": email}, format="json").status_code == 400

    def test_refuses_an_email_already_in_use(self, me):
        client, _ = me
        ParentFactory(email="familia@x.mx")
        resp = client.patch(self.url(teacher()), {"email": "FAMILIA@x.mx"}, format="json")
        assert resp.status_code == 400 and "email" in resp.data

    def test_a_name_cannot_be_blank(self, me):
        client, _ = me
        assert client.patch(self.url(teacher()), {"first_name": " "}, format="json").status_code == 400


class TestActivity:
    def test_shows_the_account_and_its_last_actions(self, me):
        client, _ = me
        t = teacher()
        for i in range(25):
            record("update", t, {"n": [i, i + 1]}, actor=t, context="test")

        resp = client.get(reverse("admin-staff-activity", args=[t.id]))

        assert resp.status_code == 200
        assert resp.data["user"]["id"] == t.id
        assert resp.data["total_actions"] == 25 and len(resp.data["recent"]) == 20

    def test_each_row_says_who_or_what_it_is_about(self, me):
        client, _ = me
        t = teacher()
        student = StudentProfileFactory(user__first_name="Ana", user__last_name="Ríos")
        record("update", student, {"group": ["A", "B"]}, actor=t, context="test")
        record("permission", student.user, {"is_active": [True, False]}, actor=t, context="test")
        record("update", t, {"first_name": ["X", "Y"]}, actor=t, context="test")

        recent = client.get(reverse("admin-staff-activity", args=[t.id])).data["recent"]

        labels = [r["object_label"] for r in recent]
        # The file and the login of one student both read as the student's name.
        assert labels.count("Ana Ríos") == 2
        assert t.full_name in labels or t.email in labels

    def test_a_family_account_is_not_found_here(self, me):
        client, _ = me
        assert client.get(reverse("admin-staff-activity", args=[ParentFactory().id])).status_code == 404


class TestNoSessionForADeactivatedAccount:
    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_google_sign_in_is_refused(self, mock_verify, api_client):
        UserFactory(email="baja@x.mx", role=User.Role.STAFF, is_active=False, password=None)
        mock_verify.return_value = {"sub": "g-9", "email": "baja@x.mx", "email_verified": True}

        resp = api_client.post(reverse("google-token"), {"credential": "fake"}, format="json")

        assert resp.status_code == 403
        assert resp.data["code"] == "inactive"
        assert "access" not in resp.data
