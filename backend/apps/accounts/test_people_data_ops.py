"""
Usuarios del personal, Solicitudes de contraseña and the guardians sub-list on
the Data Ops contracts: list (q, ordering, filters, page_size, O(1) queries),
export (CSV/XLSX/PDF, audited), bulk (deactivate/reactivate with the per-row
guards; reject with a required note) and the staff import (invite).
"""

import csv
import io

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory, UserFactory
from apps.accounts.models import PasswordRequest, User
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


def _body(resp) -> bytes:
    return b"".join(resp.streaming_content) if resp.streaming else resp.content


def _csv_rows(resp):
    return list(csv.reader(io.StringIO(_body(resp).decode("utf-8-sig"))))


@pytest.fixture
def me(api_client):
    admin = AdminFactory(first_name="Yo", last_name="Admin", password=None)
    api_client.force_authenticate(admin)
    return api_client, admin


@pytest.fixture
def staff():
    return [
        UserFactory(
            role="staff", email="berta@x.mx", first_name="Berta", last_name="Zea", password=None
        ),
        UserFactory(
            role="staff",
            email="carlos@x.mx",
            first_name="Carlos",
            last_name="Alba",
            is_active=False,
            password=None,
        ),
        UserFactory(
            role="admin",
            email="dora@x.mx",
            first_name="Dora",
            last_name="Mena",
            is_staff=True,
            password=None,
        ),
    ]


# ── staff list / export ──────────────────────────────────────
class TestStaffList:
    URL = reverse("admin-staff")

    def _emails(self, resp):
        return [r["email"] for r in resp.data["results"]]

    def test_q_ordering_filters(self, me, staff):
        c, admin = me
        ParentFactory(email="parent@x.mx")
        assert self._emails(c.get(self.URL, {"q": "zea"})) == ["berta@x.mx"]
        assert self._emails(c.get(self.URL, {"ordering": "name"}))[:2] == [
            admin.email,
            "carlos@x.mx",
        ]
        assert self._emails(c.get(self.URL, {"rol": "admin", "ordering": "email"})) == [
            admin.email,
            "dora@x.mx",
        ]
        assert self._emails(c.get(self.URL, {"active": "0"})) == ["carlos@x.mx"]
        resp = c.get(self.URL, {"page_size": 2})
        assert resp.data["count"] == 4 and len(resp.data["results"]) == 2 and resp.data["next"]
        assert "parent@x.mx" not in self._emails(c.get(self.URL, {"page_size": 50}))

    @pytest.mark.parametrize("n", [3, 9])
    def test_constant_queries(self, me, django_assert_num_queries, n):
        c, _ = me
        for i in range(n):
            UserFactory(role="staff", email=f"s{i}@x.mx", password=None)
        with django_assert_num_queries(2):
            assert c.get(self.URL).status_code == 200

    def test_export_formats_and_audit(self, me, staff):
        c, admin = me
        url = reverse("admin-staff-export")
        rows = _csv_rows(c.get(url, {"activo": "1", "ordering": "email"}))
        assert rows[0][:3] == ["Nombre", "Correo", "Rol"]
        assert [r[1] for r in rows[1:]] == [admin.email, "berta@x.mx", "dora@x.mx"]
        assert c.get(url, {"fmt": "xlsx"}).status_code == 200
        assert _body(c.get(url, {"fmt": "pdf"})).startswith(b"%PDF")
        assert AuditLog.objects.filter(object_type="export:staff").count() == 3
        # The export view never invites.
        assert c.post(url, {"email": "x@x.mx", "first_name": "X"}, format="json").status_code == 405


# ── staff bulk ───────────────────────────────────────────────
class TestStaffBulk:
    URL = reverse("admin-staff-bulk")

    def _post(self, client, action, ids, **extra):
        return client.post(self.URL, {"action": action, "ids": ids, **extra}, format="json")

    def test_deactivate_with_guards_and_audit(self, me, staff):
        c, admin = me
        berta, carlos, dora = staff
        parent = ParentFactory()
        root = UserFactory(role="admin", is_superuser=True, email="root@x.mx", password=None)
        ids = [berta.id, carlos.id, dora.id, admin.id, parent.id, root.id]
        plan = self._post(c, "deactivate", ids, dry_run=True).data
        assert plan["ok"] == 2
        reasons = {s["id"]: s["reason"] for s in plan["skipped"]}
        assert reasons[carlos.id] == "Ya está desactivada."
        assert reasons[admin.id] == "No puede desactivar su propia cuenta."
        assert "personal" in reasons[parent.id] and "superusuario" in reasons[root.id]
        body = self._post(c, "deactivate", ids).data
        assert body["ok"] == 2
        berta.refresh_from_db()
        dora.refresh_from_db()
        assert not berta.is_active and not dora.is_active
        admin.refresh_from_db()
        assert admin.is_active
        assert AuditLog.objects.filter(context="bulk:accounts.user:deactivate").count() == 2

    def test_reactivate(self, me, staff):
        c, _ = me
        _, carlos, _ = staff
        assert self._post(c, "reactivate", [carlos.id]).data["ok"] == 1
        carlos.refresh_from_db()
        assert carlos.is_active

    def test_last_active_admin_is_guarded(self, me):
        from apps.accounts.staff_users import _bulk_guard

        _, admin = me
        other = AdminFactory(password=None)
        admin.is_active = False
        admin.save(update_fields=["is_active"])
        with pytest.raises(ValueError, match="al menos un administrador"):
            _bulk_guard(other, admin, active=False)

    def test_parent_forbidden(self, api_client, parent_user, staff):
        api_client.force_authenticate(parent_user)
        assert self._post(api_client, "deactivate", [staff[0].id]).status_code == 403


# ── staff import (invite) ────────────────────────────────────
class TestStaffImport:
    URL = reverse("admin-staff-import")

    def _file(self, *lines):
        f = io.BytesIO(("correo,nombre,apellidos,rol\n" + "\n".join(lines)).encode("utf-8"))
        f.name = "personal.csv"
        return f

    def test_template(self, me):
        c, _ = me
        resp = c.get(reverse("admin-staff-import-template"), {"fmt": "csv"})
        assert resp.content.decode("utf-8-sig").startswith("correo,nombre,apellidos,rol")

    def test_dry_run_then_commit_invites_without_passwords(self, me, staff):
        c, _ = me
        ParentFactory(email="papa@x.mx")
        lines = (
            "Nueva@X.mx,Nueva,Persona,Personal",
            "jefa@x.mx,Jefa,Uno,administrador",
            "berta@x.mx,Berta,Zea,staff",  # already staff → omitir
            "papa@x.mx,Papá,X,staff",  # a family account → error
            "otra@x.mx,Otra,Y,director",  # unknown role → error
        )
        plan = c.post(self.URL, {"file": self._file(*lines)}, format="multipart").json()
        assert [r["action"] for r in plan["rows"]] == ["crear", "crear", "omitir", "error", "error"]
        assert not User.objects.filter(email="nueva@x.mx").exists()
        body = c.post(
            self.URL,
            {"file": self._file(*lines), "dry_run": "0", "valid_only": "1"},
            format="multipart",
        ).json()
        assert body["counts"]["crear"] == 2
        nueva = User.objects.get(email="nueva@x.mx")
        jefa = User.objects.get(email="jefa@x.mx")
        assert nueva.role == "staff" and not nueva.is_staff and not nueva.has_usable_password()
        assert jefa.role == "admin" and jefa.is_staff
        assert "temporary_password" not in str(body)
        assert AuditLog.objects.filter(object_type="import:staff").count() == 1


# ── password requests ────────────────────────────────────────
@pytest.fixture
def requests_():
    parent = ParentFactory(email="mama@x.mx", first_name="Marta", password=None)
    return [
        PasswordRequest.objects.create(
            user=parent, requested_email="mama@x.mx", requester_name="Marta", channel="whatsapp"
        ),
        PasswordRequest.objects.create(
            requested_email="nadie@x.mx", requester_name="Nadie", channel="phone"
        ),
        PasswordRequest.objects.create(
            requested_email="viejo@x.mx", channel="email", status="resolved"
        ),
    ]


class TestPasswordRequestList:
    URL = reverse("password-requests")

    def _emails(self, resp):
        return [r["requested_email"] for r in resp.data["results"]]

    def test_q_filters_ordering_and_open_count(self, me, requests_):
        c, _ = me
        resp = c.get(self.URL, {"estado": "open", "ordering": "requested_email"})
        assert self._emails(resp) == ["mama@x.mx", "nadie@x.mx"] and resp.data["open_count"] == 2
        assert self._emails(c.get(self.URL, {"q": "marta"})) == ["mama@x.mx"]
        assert self._emails(c.get(self.URL, {"canal": "phone"})) == ["nadie@x.mx"]
        assert self._emails(c.get(self.URL, {"linked": "1"})) == ["mama@x.mx"]
        assert c.get(self.URL, {"from": "2000-01-01", "to": "2000-01-02"}).data["count"] == 0
        assert c.get(self.URL).data["count"] == 3

    @pytest.mark.parametrize("n", [2, 8])
    def test_constant_queries(self, me, django_assert_num_queries, n):
        c, _ = me
        for i in range(n):
            PasswordRequest.objects.create(
                requested_email=f"r{i}@x.mx", user=AdminFactory(password=None)
            )
        with django_assert_num_queries(3):  # count + page + open_count
            assert c.get(self.URL).status_code == 200

    def test_export(self, me, requests_):
        c, _ = me
        rows = _csv_rows(c.get(reverse("password-requests-export"), {"estado": "resolved"}))
        assert rows[0][:3] == ["Fecha", "Correo solicitado", "Solicitante"]
        assert [r[1] for r in rows[1:]] == ["viejo@x.mx"]
        assert AuditLog.objects.filter(object_type="export:password_requests").exists()


class TestPasswordRequestReject:
    BULK = reverse("password-requests-bulk")

    def test_bulk_reject_requires_a_note_and_skips_closed(self, me, requests_):
        c, _ = me
        ids = [r.id for r in requests_]
        no_note = c.post(self.BULK, {"action": "reject", "ids": ids}, format="json")
        assert no_note.status_code == 400
        body = c.post(
            self.BULK,
            {"action": "reject", "ids": ids, "payload": {"note": "No identificado"}},
            format="json",
        ).data
        assert body["ok"] == 2 and body["skipped"][0]["id"] == requests_[2].id
        rejected = PasswordRequest.objects.get(pk=requests_[0].pk)
        assert rejected.status == "rejected" and rejected.note == "No identificado"
        assert rejected.resolved_by is not None
        assert AuditLog.objects.filter(context="bulk:accounts.passwordrequest:reject").count() == 2

    def test_single_reject_is_audited(self, me, requests_):
        c, _ = me
        resp = c.patch(
            reverse("password-request-detail", args=[requests_[1].pk]),
            {"action": "reject", "note": "Sin cuenta"},
            format="json",
        )
        assert resp.status_code == 200 and resp.data["status"] == "rejected"
        log = AuditLog.objects.get(context="portal: solicitud de contraseña rechazada")
        assert log.changes["status"] == ["open", "rejected"] and log.changes["note"] == "Sin cuenta"


# ── guardians sub-list ───────────────────────────────────────
class TestGuardiansSubList:
    def test_q_and_ordering(self, me):
        c, _ = me
        student = StudentProfileFactory(user__password=None)
        ana = ParentFactory(first_name="Ana", last_name="Zapata", email="ana@x.mx", password=None)
        beto = ParentFactory(
            first_name="Beto",
            last_name="Arce",
            email="beto@x.mx",
            whatsapp="5215511",
            password=None,
        )
        student.parents.add(student.user, ana, beto)
        url = reverse("student-guardians", args=[student.pk])
        default = c.get(url).data
        assert default["count"] == 3
        assert [g["email"] for g in default["guardians"]][
            0
        ] == student.user.email  # family account first
        assert [g["email"] for g in c.get(url, {"q": "zapata"}).data["guardians"]] == ["ana@x.mx"]
        assert [g["email"] for g in c.get(url, {"q": "215511"}).data["guardians"]] == ["beto@x.mx"]
        by_email = c.get(url, {"ordering": "-email"}).data["guardians"]
        assert [g["email"] for g in by_email][-2:] == ["beto@x.mx", "ana@x.mx"]
        by_name = c.get(url, {"ordering": "name"}).data["guardians"]
        assert by_name[0]["email"] == "beto@x.mx"
