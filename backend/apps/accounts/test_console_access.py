"""Console access on a staff cafetería login (owner, 2026-11-25).

The office could not invite the person in charge of admissions: her address
already belonged to her «Personal del colegio» cafetería login (role student
with a ``tipo='personal'`` profile). That same login now gets the console
(role staff with areas) and can lose it again, wallet untouched, and Usuarios
offers it instead of «ya está registrado». Invented names only (the
repository is public).
"""

from decimal import Decimal

import pytest
from django.urls import reverse
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
    StudentUserFactory,
    UserFactory,
)
from apps.accounts.models import StudentProfile, User
from apps.cafeteria.models import CafeteriaBalance
from apps.core.areas import PUESTOS
from apps.core.models import AuditLog
from apps.portal.models import Announcement
from apps.portal.services import audience_users

pytestmark = pytest.mark.django_db


def staff_wallet(email="rlince@interlaken.com.mx", *, user=None, balance="35.00", **kw):
    """A staff cafetería account; by default on its own role-student login."""
    user = user or StudentUserFactory(email=email, first_name="Rosa", last_name="Lince")
    profile = StudentProfileFactory(
        user=user,
        tipo="personal",
        grade="",
        group="",
        puesto=kw.pop("puesto", "administracion"),
        **kw,
    )
    CafeteriaBalance.objects.create(student=profile, balance=Decimal(balance))
    return profile


@pytest.fixture
def admin_api(api_client):
    admin = AdminFactory()
    api_client.force_authenticate(user=admin)
    return api_client, admin


def access_url(user):
    return reverse("admin-staff-console-access", args=[user.pk])


def grant(client, user, **body):
    return client.post(access_url(user), {"puesto": "admisiones", **body}, format="json")


class TestPreset:
    def test_admisiones_preset(self):
        assert PUESTOS["admisiones"] == ("Admisiones", ("admisiones", "visitas", "mensajes"))


class TestGrant:
    def test_gives_the_same_login_the_console_and_keeps_the_wallet(
        self, admin_api, mailoutbox, settings
    ):
        settings.FRONTEND_URL = "https://colegio.test"
        client, admin = admin_api
        profile = staff_wallet(loyverse_id="loy-rosa")
        user = profile.user
        user.set_unusable_password()  # like the imported staff logins in production
        user.save(update_fields=["password"])
        password_before = user.password
        resp = grant(client, user)
        assert resp.status_code == 200, resp.data
        assert resp.data["role"] == "staff"
        assert resp.data["staff_areas"] == ["admisiones", "visitas", "mensajes"]
        assert resp.data["staff_title"] == "Admisiones"
        assert resp.data["has_cafeteria"] is True
        assert resp.data["invite_email_sent"] is True
        user.refresh_from_db()
        assert (user.role, user.is_staff) == (User.Role.STAFF, False)
        assert user.password == password_before  # no password generated: Google
        assert user.password_change_required is False
        profile.refresh_from_db()
        assert (profile.tipo, profile.puesto, profile.loyverse_id) == (
            "personal",
            "administracion",
            "loy-rosa",
        )
        assert profile.cafeteria_balance.balance == Decimal("35.00")
        row = AuditLog.objects.get(context="portal: acceso a la consola")
        assert row.actor == admin and row.object_id == str(user.pk)
        assert row.changes["role"] == ["student", "staff"]
        assert row.changes["staff_areas"] == [[], ["admisiones", "visitas", "mensajes"]]
        # The email: Google wording, the areas, the wallet kept, never a password.
        assert len(mailoutbox) == 1
        sent = mailoutbox[0]
        assert sent.to == ["rlince@interlaken.com.mx"]
        assert sent.subject == "Ya puede entrar a la consola del Colegio Interlaken"
        assert "Continuar con Google" in sent.body
        assert "https://colegio.test/login" in sent.body
        assert "Admisiones, Visitas y agenda, Mensajes y formularios" in sent.body
        assert "Mi cafetería" in sent.body
        assert "contraseña temporal" not in sent.body

    def test_explicit_areas_and_title(self, admin_api):
        client, _ = admin_api
        user = staff_wallet().user
        resp = client.post(
            access_url(user),
            {"staff_title": "Coordinación", "staff_areas": ["visitas"]},
            format="json",
        )
        assert resp.status_code == 200, resp.data
        user.refresh_from_db()
        assert (user.staff_title, user.staff_areas) == ("Coordinación", ["visitas"])

    def test_needs_at_least_one_area(self, admin_api, mailoutbox):
        client, _ = admin_api
        user = staff_wallet().user
        resp = client.post(access_url(user), {"staff_areas": []}, format="json")
        assert resp.status_code == 400 and "staff_areas" in resp.data
        user.refresh_from_db()
        assert user.role == User.Role.STUDENT and mailoutbox == []

    def test_unknown_area_or_puesto(self, admin_api):
        client, _ = admin_api
        user = staff_wallet().user
        assert (
            client.post(access_url(user), {"staff_areas": ["root"]}, format="json").status_code
            == 400
        )
        assert client.post(access_url(user), {"puesto": "jefe"}, format="json").status_code == 400

    @pytest.mark.parametrize("kind", ["parent", "pupil", "parent_with_wallet"])
    def test_families_and_pupils_are_refused(self, admin_api, kind, mailoutbox):
        client, _ = admin_api
        if kind == "parent":
            user = ParentFactory()
        elif kind == "pupil":
            user = StudentProfileFactory().user
        else:
            # A parent who also works here: their login is the family's (children).
            user = ParentFactory()
            staff_wallet(user=user)
        resp = grant(client, user)
        assert resp.status_code == 400 and resp.data["code"] == "family_login"
        assert "familia o de un alumno" in resp.data["detail"]
        user.refresh_from_db()
        assert user.role != User.Role.STAFF and mailoutbox == []

    def test_console_users_and_superusers_conflict(self, admin_api):
        client, _ = admin_api
        teacher = UserFactory(role=User.Role.STAFF)
        resp = grant(client, teacher)
        assert resp.status_code == 409 and resp.data["code"] == "already_console"
        root = AdminFactory(is_superuser=True)
        assert grant(client, root).status_code == 409

    def test_archived_and_inactive_logins_are_refused(self, admin_api):
        client, _ = admin_api
        from django.utils import timezone

        archived = staff_wallet("a@test.mx").user
        archived.archived_at = timezone.now()
        archived.save(update_fields=["archived_at"])
        assert grant(client, archived).data["code"] == "archived"
        inactive = staff_wallet("i@test.mx").user
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        assert grant(client, inactive).data["code"] == "inactive"

    def test_admins_only(self, api_client):
        user = staff_wallet().user
        api_client.force_authenticate(
            user=UserFactory(role=User.Role.STAFF, staff_areas=["alumnos"])
        )
        assert grant(api_client, user).status_code == 403
        user.refresh_from_db()
        assert user.role == User.Role.STUDENT

    def test_unknown_account(self, admin_api):
        client, _ = admin_api
        assert (
            client.post(
                reverse("admin-staff-console-access", args=[999999]),
                {"puesto": "admisiones"},
                format="json",
            ).status_code
            == 404
        )

    def test_the_promoted_login_reaches_its_areas_only(self, admin_api, api_client):
        client, _ = admin_api
        user = staff_wallet().user
        assert grant(client, user).status_code == 200
        user.refresh_from_db()
        api_client.force_authenticate(user=user)
        assert api_client.get(reverse("bookings-admin-list")).status_code == 200  # Visitas
        assert api_client.get(reverse("admin-staff")).status_code == 403  # Usuarios
        assert (
            api_client.post(reverse("admin-student-bulk"), {}, format="json").status_code == 403
        )  # Alumnos
        me = api_client.get(reverse("current-user")).data
        assert me["role"] == "staff" and me["cafeteria_account"]["tipo"] == "personal"

    def test_still_personal_for_comunicados_never_family(self, admin_api):
        client, _ = admin_api
        user = staff_wallet().user
        grant(client, user)
        staff_ids = set(audience_users(Announcement.Audience.STAFF).values_list("pk", flat=True))
        assert user.pk in staff_ids
        for aud in (Announcement.Audience.PARENTS, Announcement.Audience.STUDENTS):
            assert user.pk not in set(audience_users(aud).values_list("pk", flat=True))


class TestRemove:
    def _promoted(self, client):
        user = staff_wallet().user
        assert grant(client, user).status_code == 200
        user.refresh_from_db()
        return user

    def test_back_to_a_cafeteria_only_login(self, admin_api):
        client, admin = admin_api
        user = self._promoted(client)
        token = RefreshToken.for_user(user)
        resp = client.delete(access_url(user))
        assert resp.status_code == 200, resp.data
        assert resp.data["role"] == "student" and resp.data["sessions_revoked"] >= 1
        user.refresh_from_db()
        assert (user.role, user.staff_areas, user.staff_title) == (User.Role.STUDENT, [], "")
        assert BlacklistedToken.objects.filter(token__jti=token["jti"]).exists()
        profile = StudentProfile.objects.get(user=user)
        assert profile.tipo == "personal" and profile.cafeteria_balance.balance == Decimal("35.00")
        row = AuditLog.objects.get(context="portal: quitar acceso a la consola")
        assert row.actor == admin and row.changes["role"] == ["staff", "student"]
        # And it can be given again.
        assert grant(client, user).status_code == 200

    def test_refusals(self, admin_api):
        client, admin = admin_api
        assert client.delete(access_url(admin)).status_code == 400  # oneself
        other_admin = AdminFactory()
        staff_wallet(user=other_admin)
        resp = client.delete(access_url(other_admin))
        assert resp.status_code == 400 and "Personal en Usuarios" in resp.data["detail"]
        no_wallet = UserFactory(role=User.Role.STAFF, staff_areas=["visitas"])
        resp = client.delete(access_url(no_wallet))
        assert resp.status_code == 400 and "desactívela en Usuarios" in resp.data["detail"]
        cafeteria_only = staff_wallet("c@test.mx").user
        assert client.delete(access_url(cafeteria_only)).status_code == 400
        root = AdminFactory(is_superuser=True)
        assert client.delete(access_url(root)).status_code == 403
        no_wallet.refresh_from_db()
        assert no_wallet.role == User.Role.STAFF


class TestUsuariosInvite:
    def _invite(self, client, email, role="staff"):
        return client.post(
            reverse("admin-staff"),
            {"email": email, "first_name": "Rosa", "role": role},
            format="json",
        )

    def test_a_staff_cafeteria_login_is_offered_console_access(self, admin_api, mailoutbox):
        client, _ = admin_api
        profile = staff_wallet("RLince@Interlaken.com.mx", puesto="docente")
        resp = self._invite(client, "rlince@interlaken.com.mx")
        assert resp.status_code == 409
        assert resp.data["code"] == "staff_cafeteria_login"
        assert resp.data["person"] == {
            "id": profile.user_id,
            "full_name": "Rosa Lince",
            "email": "RLince@Interlaken.com.mx",
            "puesto_label": "Docente",
        }
        assert User.objects.filter(email__iexact="rlince@interlaken.com.mx").count() == 1
        assert mailoutbox == []

    def test_family_and_pupil_addresses_are_refused_with_the_reason(self, admin_api):
        client, _ = admin_api
        ParentFactory(email="mama@test.mx")
        StudentUserFactory(email="ci09999@test.mx")
        for email in ("mama@test.mx", "ci09999@test.mx"):
            resp = self._invite(client, email)
            assert resp.status_code == 400
            assert "familia o de un alumno" in resp.data["email"][0]

    def test_console_users_and_archived_ones(self, admin_api):
        client, _ = admin_api
        UserFactory(role=User.Role.STAFF, email="caja@test.mx")
        assert self._invite(client, "caja@test.mx").data["email"] == [
            "Ese correo ya es usuario de la consola."
        ]
        from django.utils import timezone

        UserFactory(role=User.Role.STAFF, email="vieja@test.mx", archived_at=timezone.now())
        assert "archivada" in self._invite(client, "vieja@test.mx").data["email"][0]

    def test_the_list_says_who_also_has_a_wallet(self, admin_api, django_assert_max_num_queries):
        client, _ = admin_api
        user = staff_wallet().user
        grant(client, user)
        UserFactory(role=User.Role.STAFF, email="sin@test.mx")
        with django_assert_max_num_queries(4):
            rows = client.get(reverse("admin-staff")).data["results"]
        flags = {r["email"]: r["has_cafeteria"] for r in rows}
        assert flags["rlince@interlaken.com.mx"] is True and flags["sin@test.mx"] is False


class TestPersonalList:
    URL = "students"

    def test_puesto_filter_and_ordering(self, admin_api):
        client, _ = admin_api
        staff_wallet("d@test.mx", puesto="docente")
        staff_wallet("m@test.mx", puesto="mantenimiento")
        StudentProfileFactory()
        rows = client.get(reverse(self.URL), {"tipo": "personal", "puesto": "docente"}).data[
            "results"
        ]
        assert [r["user"]["email"] for r in rows] == ["d@test.mx"]
        # An unknown puesto is ignored, never a 400 (stale bookmarks).
        assert (
            client.get(reverse(self.URL), {"tipo": "personal", "puesto": "jefe"}).data["count"] == 2
        )
        rows = client.get(reverse(self.URL), {"tipo": "personal", "ordering": "-puesto"}).data[
            "results"
        ]
        assert [r["puesto"] for r in rows] == ["mantenimiento", "docente"]

    def test_the_row_carries_the_console_access(self, admin_api):
        client, _ = admin_api
        user = staff_wallet().user
        grant(client, user)
        row = client.get(reverse(self.URL), {"tipo": "personal"}).data["results"][0]
        assert row["user"]["role"] == "staff"
        assert row["user"]["staff_areas"] == ["admisiones", "visitas", "mensajes"]

    def test_bulk_puesto_changes_staff_and_skips_pupils(self, admin_api):
        client, admin = admin_api
        teacher = staff_wallet("d@test.mx", puesto="sin_asignar")
        same = staff_wallet("e@test.mx", puesto="docente")
        pupil = StudentProfileFactory()
        body = {
            "action": "puesto",
            "ids": [teacher.pk, same.pk, pupil.pk],
            "payload": {"value": "docente"},
            "dry_run": False,
        }
        resp = client.post(reverse("admin-student-bulk"), body, format="json")
        assert resp.status_code == 200, resp.data
        assert resp.data["ok"] == 1
        reasons = {s["id"]: s["reason"] for s in resp.data["skipped"]}
        assert reasons == {same.pk: "Ya tiene ese puesto.", pupil.pk: "No es personal del colegio."}
        teacher.refresh_from_db()
        pupil.refresh_from_db()
        assert teacher.puesto == "docente" and pupil.puesto == ""
        row = AuditLog.objects.filter(
            object_type="accounts.studentprofile", object_id=str(teacher.pk)
        ).latest("id")
        assert row.changes["puesto"] == ["sin_asignar", "docente"] and row.actor == admin

    def test_bulk_puesto_rejects_an_unknown_value(self, admin_api):
        client, _ = admin_api
        teacher = staff_wallet()
        body = {
            "action": "puesto",
            "ids": [teacher.pk],
            "payload": {"value": "jefe"},
            "dry_run": False,
        }
        assert client.post(reverse("admin-student-bulk"), body, format="json").status_code == 400
