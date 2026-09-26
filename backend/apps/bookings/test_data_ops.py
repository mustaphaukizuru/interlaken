"""
Visitas on the Data Ops contracts (Phase 5): list contract, exports, bulk
actions, single-row guard parity, capacity by ``num_attendees`` and the slot
import. See ``apps/bookings/data_ops.py`` and ``services/status.py``.
"""

import io
from datetime import date, time, timedelta

import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone

from apps.core.models import AuditLog

from .data_ops import BOOKING_ORDERING, SLOT_ORDERING, parse_hhmm
from .models import AvailabilitySlot, Booking, VisitType

pytestmark = pytest.mark.django_db

S = Booking.Status


def _slot(days=3, hour=9, capacity=5, visit_type=VisitType.INDIVIDUAL, **kw):
    return AvailabilitySlot.objects.create(
        visit_type=visit_type,
        date=timezone.localdate() + timedelta(days=days),
        start_time=time(hour, 0),
        end_time=time(hour, 30),
        capacity=capacity,
        **kw,
    )


def _booking(slot, name="Ana", status=S.CONFIRMED, attendees=1, **kw):
    kw.setdefault("parent_email", f"{name.lower()}@test.mx")
    kw.setdefault("parent_phone", "5512345678")
    return Booking.objects.create(
        slot=slot, parent_name=name, status=status, num_attendees=attendees, **kw
    )


def _body(resp) -> str:
    if getattr(resp, "streaming", False):
        return b"".join(resp.streaming_content).decode("utf-8-sig")
    return resp.content.decode("utf-8-sig")


def _upload(text: str, name="horarios.csv"):
    f = io.BytesIO(text.encode("utf-8"))
    f.name = name
    return f


# ── list contract ─────────────────────────────────────────
class TestBookingList:
    URL = "bookings-admin-list"

    def test_ordering_whitelist_is_the_frontend_contract(self):
        # Keep in sync with frontend AdminBookings sortKey values (docs/API-LISTING.md).
        assert set(BOOKING_ORDERING) == {
            "date",
            "status",
            "parent",
            "child",
            "created_at",
            "attendees",
        }
        assert set(SLOT_ORDERING) == {"date", "start", "type", "capacity", "booked"}

    def test_q_searches_phone_and_child(self, admin_client):
        slot = _slot()
        _booking(slot, "Ana", parent_phone="5511110000", child_name="Lucía")
        _booking(slot, "Beto", parent_phone="5522220000", child_name="Mateo")
        url = reverse(self.URL)
        assert [r["parent_name"] for r in admin_client.get(url, {"q": "2222"}).data["results"]] == [
            "Beto"
        ]
        assert [
            r["parent_name"] for r in admin_client.get(url, {"q": "Lucía"}).data["results"]
        ] == ["Ana"]

    def test_filters_source_status_and_date_range(self, admin_client):
        near, far = _slot(days=2), _slot(days=20, hour=10)
        _booking(near, "Ana", source=Booking.Source.WHATSAPP)
        _booking(far, "Beto", status=S.PENDING)
        url = reverse(self.URL)
        assert admin_client.get(url, {"source": "whatsapp"}).data["count"] == 1
        assert admin_client.get(url, {"status": "pending"}).data["results"][0]["parent_name"] == (
            "Beto"
        )
        to = (timezone.localdate() + timedelta(days=5)).isoformat()
        names = [r["parent_name"] for r in admin_client.get(url, {"to": to}).data["results"]]
        assert names == ["Ana"]
        frm = (timezone.localdate() + timedelta(days=10)).isoformat()
        assert admin_client.get(url, {"from": frm}).data["count"] == 1
        assert admin_client.get(url, {"status": "bogus"}).status_code == 400

    def test_ordering_keys_and_fallback(self, admin_client):
        slot = _slot()
        _booking(slot, "Carla", attendees=3)
        _booking(slot, "Ana", attendees=1)
        _booking(slot, "Beto", attendees=2)
        url = reverse(self.URL)

        def names(ordering):
            return [
                r["parent_name"]
                for r in admin_client.get(url, {"ordering": ordering}).data["results"]
            ]

        assert names("parent") == ["Ana", "Beto", "Carla"]
        assert names("-attendees") == ["Carla", "Beto", "Ana"]
        # Unknown key: default order (date desc) with the -pk tiebreak, never a 500.
        assert names("parent_email") == ["Beto", "Ana", "Carla"]

    def test_page_size(self, admin_client):
        slot = _slot(capacity=50)
        for i in range(5):
            _booking(slot, f"P{i}")
        resp = admin_client.get(reverse(self.URL), {"page_size": 2})
        assert resp.data["count"] == 5 and len(resp.data["results"]) == 2

    @pytest.mark.parametrize("n", [3, 30])
    def test_query_budget(self, admin_client, django_assert_num_queries, n):
        for i in range(n):
            _booking(_slot(days=2 + i, hour=9), f"P{i}")
        with django_assert_num_queries(2):  # count + page (slot joined)
            resp = admin_client.get(reverse(self.URL), {"page_size": 100})
        assert resp.data["count"] == n


class TestSlotList:
    URL = "bookings-admin-slots"

    def test_q_filters_and_ordering_by_booked(self, admin_client):
        a = _slot(days=2, location="Auditorio")
        b = _slot(days=3, location="Campus", title="Puertas", visit_type=VisitType.OPEN_CLASS)
        _slot(days=4, is_active=False)
        _booking(b, "Ana", attendees=3)
        _booking(a, "Beto", attendees=1)
        url = reverse(self.URL)
        assert admin_client.get(url, {"q": "audit"}).data["results"][0]["id"] == a.pk
        assert admin_client.get(url, {"q": "puertas"}).data["results"][0]["id"] == b.pk
        assert admin_client.get(url, {"active": "false"}).data["count"] == 1
        assert admin_client.get(url, {"type": "open_class"}).data["count"] == 1
        ids = [r["id"] for r in admin_client.get(url, {"ordering": "-booked"}).data["results"]]
        assert ids[:2] == [b.pk, a.pk]

    @pytest.mark.parametrize("n", [3, 30])
    def test_query_budget(self, admin_client, django_assert_num_queries, n):
        for i in range(n):
            _booking(_slot(days=2 + i), f"P{i}", attendees=2)
        with django_assert_num_queries(2):  # count + annotated page
            resp = admin_client.get(reverse(self.URL), {"page_size": 100})
        assert resp.data["results"][0]["booked_count"] == 2


# ── single-row actions: guard, capacity, audit ────────────
class TestSingleRowActions:
    def _act(self, client, booking, action, **body):
        return client.post(
            reverse("bookings-admin-action", args=[booking.pk, action]), body, format="json"
        )

    def test_cancelled_cannot_be_confirmed(self, admin_client):
        b = _booking(_slot(), status=S.CANCELLED)
        resp = self._act(admin_client, b, "confirm")
        assert resp.status_code == 400
        assert "No se puede pasar" in str(resp.data)
        b.refresh_from_db()
        assert b.status == S.CANCELLED

    def test_no_show_cannot_be_confirmed(self, admin_client):
        b = _booking(_slot(), status=S.NO_SHOW)
        assert self._act(admin_client, b, "confirm").status_code == 400

    def test_reopen_needs_a_note_and_checks_capacity_by_attendees(self, admin_client):
        slot = _slot(capacity=4)
        _booking(slot, "Otra", attendees=3)  # ONE row, three seats
        b = _booking(slot, "Ana", status=S.CANCELLED, attendees=2)
        assert self._act(admin_client, b, "reopen").status_code == 400  # note required
        resp = self._act(admin_client, b, "reopen", note="La familia llamó")
        # A row count (1 + 2 <= 4) would have let it through; seats say 3 + 2 > 4.
        assert resp.status_code == 400 and "cupo" in str(resp.data)
        b.refresh_from_db()
        assert b.status == S.CANCELLED

    def test_reopen_ok_when_seats_free_ignores_no_shows(self, admin_client):
        slot = _slot(capacity=4)
        _booking(slot, "Ausente", status=S.NO_SHOW, attendees=3)  # frees its seats
        b = _booking(slot, "Ana", status=S.CANCELLED, attendees=2)
        resp = self._act(admin_client, b, "reopen", note="Reagenda")
        assert resp.status_code == 200 and resp.data["status"] == "pending"
        entry = AuditLog.objects.get(object_type="bookings.booking", object_id=str(b.pk))
        assert entry.changes == {"status": ["cancelled", "pending"], "note": "Reagenda"}
        assert entry.context == "bookings: reopen"

    def test_confirm_emails_unless_notify_false(self, admin_client, settings):
        settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
        slot = _slot()
        quiet = _booking(slot, "Quiet", status=S.PENDING)
        loud = _booking(slot, "Loud", status=S.PENDING)
        assert self._act(admin_client, quiet, "confirm", notify=False).status_code == 200
        assert len(mail.outbox) == 0
        assert self._act(admin_client, loud, "confirm").status_code == 200
        assert len(mail.outbox) == 1 and mail.outbox[0].to == ["loud@test.mx"]

    def test_no_show_row_action_and_correction_note(self, admin_client):
        b = _booking(_slot())
        assert self._act(admin_client, b, "no_show").data["status"] == "no_show"
        assert self._act(admin_client, b, "attended").status_code == 400  # needs a note
        resp = self._act(admin_client, b, "attended", note="Llegó tarde")
        assert resp.status_code == 200 and resp.data["status"] == "attended"


class TestReschedule:
    def test_counts_attendees_not_rows(self, admin_client):
        b = _booking(_slot(days=3), "Ana", attendees=2)
        target = _slot(days=4, capacity=3)
        _booking(target, "Otra", attendees=2)  # 1 row, 2 seats: 2 + 2 > 3
        url = reverse("bookings-admin-reschedule", args=[b.pk])
        assert admin_client.post(url, {"slot": target.pk}, format="json").status_code == 400

    def test_no_show_frees_seats_like_annotate_booked(self, admin_client, settings):
        settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
        b = _booking(_slot(days=3), "Ana", attendees=2)
        target = _slot(days=4, capacity=3)
        _booking(target, "Ausente", status=S.NO_SHOW, attendees=3)
        url = reverse("bookings-admin-reschedule", args=[b.pk])
        assert admin_client.post(url, {"slot": target.pk}, format="json").status_code == 200


# ── bulk ──────────────────────────────────────────────────
class TestBookingBulk:
    URL = "bookings-admin-bulk"

    def _post(self, client, **body):
        return client.post(reverse(self.URL), body, format="json")

    def test_dry_run_plan_without_writes(self, admin_client):
        slot = _slot()
        p1 = _booking(slot, "A", status=S.PENDING)
        p2 = _booking(slot, "B", status=S.PENDING)
        c = _booking(slot, "C", status=S.CANCELLED)
        resp = self._post(admin_client, action="confirm", ids=[p1.pk, p2.pk, c.pk], dry_run=True)
        assert resp.status_code == 200
        assert resp.data["ok"] == 2 and resp.data["dry_run"] is True
        assert [s["id"] for s in resp.data["skipped"]] == [c.pk]
        assert Booking.objects.filter(status=S.PENDING).count() == 2
        assert not AuditLog.objects.filter(object_type="bulk:bookings.booking").exists()

    def test_confirm_audits_each_row_and_summary(self, admin_client, settings):
        settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
        slot = _slot()
        p1 = _booking(slot, "A", status=S.PENDING)
        p2 = _booking(slot, "B", status=S.PENDING)
        resp = self._post(
            admin_client, action="confirm", ids=[p1.pk, p2.pk], payload={"notify": False}
        )
        assert resp.data["ok"] == 2 and resp.data["failed"] == []
        assert Booking.objects.filter(status=S.CONFIRMED).count() == 2
        assert len(mail.outbox) == 0  # notify=false
        rows = AuditLog.objects.filter(object_type="bookings.booking")
        assert rows.count() == 2
        assert rows.first().changes["status"] == ["pending", "confirmed"]
        summary = AuditLog.objects.get(object_type="bulk:bookings.booking")
        assert summary.object_id == "confirm" and summary.changes["ok"] == 2

    def test_confirm_fails_a_row_whose_slot_is_over_capacity(self, admin_client):
        slot = _slot(capacity=2)
        # Data drift: two pending bookings already hold 3 seats in a 2-seat slot.
        a = _booking(slot, "A", status=S.PENDING, attendees=1)
        b = _booking(slot, "B", status=S.PENDING, attendees=2)
        resp = self._post(admin_client, action="confirm", ids=[a.pk, b.pk])
        failed = {f["id"]: f["error"] for f in resp.data["failed"]}
        assert set(failed) == {a.pk, b.pk} and "cupo" in failed[a.pk]
        assert Booking.objects.filter(status=S.CONFIRMED).count() == 0

    def test_cancel_attended_no_show_and_note_required_correction(self, admin_client):
        slot = _slot()
        a = _booking(slot, "A")
        b = _booking(slot, "B")
        att = _booking(slot, "C", status=S.ATTENDED)
        assert self._post(admin_client, action="cancel", ids=[a.pk]).data["ok"] == 1
        assert self._post(admin_client, action="attended", ids=[b.pk]).data["ok"] == 1
        resp = self._post(admin_client, action="no_show", ids=[att.pk])
        assert resp.data["ok"] == 0 and resp.data["failed"][0]["id"] == att.pk
        resp = self._post(
            admin_client, action="no_show", ids=[att.pk], payload={"note": "Error de captura"}
        )
        assert resp.data["ok"] == 1
        assert {x.status for x in Booking.objects.filter(pk__in=[a.pk, b.pk, att.pk])} == {
            S.CANCELLED,
            S.ATTENDED,
            S.NO_SHOW,
        }

    def test_all_matching_uses_list_filters(self, admin_client):
        slot = _slot(capacity=20)
        for i in range(3):
            _booking(slot, f"W{i}", source=Booking.Source.WHATSAPP)
        other = _booking(slot, "Web")
        resp = self._post(
            admin_client, action="cancel", all_matching=True, filters={"source": "whatsapp"}
        )
        assert resp.data["requested"] == 3 and resp.data["ok"] == 3
        other.refresh_from_db()
        assert other.status == S.CONFIRMED

    def test_unknown_action_and_parent_forbidden(self, admin_client, api_client, parent_user):
        b = _booking(_slot())
        assert self._post(admin_client, action="delete", ids=[b.pk]).status_code == 400
        api_client.force_authenticate(parent_user)
        assert self._post(api_client, action="cancel", ids=[b.pk]).status_code == 403


class TestSlotBulk:
    URL = "bookings-admin-slots-bulk"

    def test_activate_deactivate_and_delete_refuses_booked(self, admin_client):
        empty = _slot(days=2)
        booked = _slot(days=3)
        _booking(booked, "A", status=S.CANCELLED)  # even a cancelled booking is history
        off = _slot(days=4, is_active=False)
        url = reverse(self.URL)

        resp = admin_client.post(
            url, {"action": "deactivate", "ids": [empty.pk, off.pk]}, format="json"
        )
        assert resp.data["ok"] == 1 and resp.data["skipped"][0]["id"] == off.pk
        resp = admin_client.post(url, {"action": "activate", "ids": [off.pk]}, format="json")
        assert resp.data["ok"] == 1

        resp = admin_client.post(
            url, {"action": "delete", "ids": [empty.pk, booked.pk]}, format="json"
        )
        assert resp.data["ok"] == 1
        assert resp.data["skipped"] == [
            {
                "id": booked.pk,
                "reason": "Tiene 1 reserva(s); desactívelo para ocultarlo sin perder el historial.",
            }
        ]
        assert not AvailabilitySlot.objects.filter(pk=empty.pk).exists()
        assert AvailabilitySlot.objects.filter(pk=booked.pk).exists()
        entry = AuditLog.objects.get(object_type="bookings.availabilityslot", action="delete")
        assert entry.object_id == str(empty.pk)


# ── exports ───────────────────────────────────────────────
class TestExports:
    def test_bookings_xlsx_pdf_ids_and_audit(self, admin_client):
        slot = _slot()
        a = _booking(slot, "Ana")
        _booking(slot, "Beto")
        url = reverse("bookings-admin-export")
        resp = admin_client.get(url, {"fmt": "xlsx", "ids": str(a.pk)})
        assert resp.status_code == 200 and resp.content[:2] == b"PK"
        from openpyxl import load_workbook

        ws = load_workbook(io.BytesIO(resp.content)).active
        rows = list(ws.iter_rows(values_only=True))
        assert rows[0][3] == "Tutor" and len(rows) == 2 and rows[1][3] == "Ana"
        pdf = admin_client.get(url, {"fmt": "pdf"})
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
        audit = AuditLog.objects.filter(object_type="export:bookings").order_by("pk")
        assert [e.object_id for e in audit] == ["xlsx", "pdf"]

    def test_bookings_export_honours_q_and_ordering(self, admin_client):
        slot = _slot()
        _booking(slot, "Zoe")
        _booking(slot, "Ana")
        _booking(slot, "Mia", parent_phone="5599990000")
        body = _body(
            admin_client.get(reverse("bookings-admin-export"), {"ordering": "parent", "q": "55123"})
        )
        lines = body.strip().split("\r\n")
        assert [line.split(",")[3] for line in lines[1:]] == ["Ana", "Zoe"]

    def test_bookings_export_cap_is_413(self, admin_client, monkeypatch):
        from . import data_ops

        monkeypatch.setattr(data_ops.BOOKING_EXPORT, "pdf_row_cap", 1)
        slot = _slot()
        _booking(slot, "A")
        _booking(slot, "B")
        resp = admin_client.get(reverse("bookings-admin-export"), {"fmt": "pdf"})
        assert resp.status_code == 413
        assert resp.data["detail"] == "Acote los filtros: el límite es 1 filas."

    def test_slots_csv(self, admin_client):
        slot = _slot(location="Auditorio", capacity=4)
        _booking(slot, "A", attendees=3)
        body = _body(admin_client.get(reverse("bookings-admin-slots-export")))
        header, row = body.strip().split("\r\n")
        assert header.startswith("Fecha,Inicio,Fin,Tipo,Evento,Lugar,Cupo,Reservados,Disponibles")
        assert ",Auditorio,4,3,1," in row


# ── slot import ───────────────────────────────────────────
def _future(days=10) -> date:
    return timezone.localdate() + timedelta(days=days)


class TestSlotImport:
    URL = "bookings-admin-slots-import"

    def _csv(self, *rows):
        return "tipo,fecha,inicio,fin,cupo,lugar\n" + "\n".join(rows) + "\n"

    def _post(self, client, text, **data):
        return client.post(reverse(self.URL), {"file": _upload(text), **data}, format="multipart")

    def test_template_csv_and_xlsx(self, admin_client):
        url = reverse("bookings-admin-slots-import-template")
        body = _body(admin_client.get(url))
        assert body.splitlines()[0] == "tipo,fecha,inicio,fin,cupo,lugar,titulo"
        xlsx = admin_client.get(url, {"fmt": "xlsx"})
        assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"

    def test_dry_run_classifies_rows(self, admin_client):
        d = _future().strftime("%d/%m/%Y")
        existing = AvailabilitySlot.objects.create(
            visit_type="individual",
            date=_future(),
            start_time=time(9),
            end_time=time(9, 30),
            capacity=1,
            location="Campus Interlaken",
        )
        text = self._csv(
            f"individual,{d},09:00,09:30,1,Campus Interlaken",  # same data → omitir
            f"individual,{d},10:00,10:30,2,Campus",  # crear
            f"Puertas abiertas,{d},09:00,11:00,30,Auditorio",  # crear (open_class)
            f"individual,{d},10:00,10:30,2,Campus",  # duplicate of line 3
            "individual,01/01/2020,09:00,09:30,1,Campus",  # past
            f"individual,{d},11:00,10:30,1,Campus",  # fin <= inicio
            f"taller,{d},12:00,12:30,1,Campus",  # bad type
            f"individual,{d},9:00,9:30,3,Aula 2",  # actualizar the existing slot
        )
        resp = self._post(admin_client, text)
        assert resp.status_code == 200, resp.data
        actions = [r["action"] for r in resp.data["rows"]]
        assert actions == [
            "omitir",
            "crear",
            "crear",
            "error",
            "error",
            "error",
            "error",
            "error",
        ]
        # The last row duplicates line 2 (same tuple as the existing slot).
        assert "Duplicado de la fila 2." in resp.data["rows"][7]["errors"]
        assert "Duplicado de la fila 3." in resp.data["rows"][3]["errors"]
        assert AvailabilitySlot.objects.count() == 1 and existing.capacity == 1

    def test_commit_creates_updates_and_audits(self, admin_client):
        d = _future().strftime("%d/%m/%Y")
        existing = _slot(days=10, capacity=1)
        existing_start = existing.start_time.strftime("%H:%M")
        text = self._csv(
            f"individual,{d},{existing_start},09:30,4,Aula 2",
            f"clase abierta,{d},09:00,11:00,30,Auditorio",
        )
        resp = self._post(admin_client, text, dry_run="0")
        assert resp.status_code == 200 and resp.data["counts"]["error"] == 0
        existing.refresh_from_db()
        assert existing.capacity == 4 and existing.location == "Aula 2"
        created = AvailabilitySlot.objects.get(visit_type="open_class")
        assert created.title == "Puertas Abiertas" and created.capacity == 30
        per_row = AuditLog.objects.filter(
            context="import:bookings.slots", object_type="bookings.availabilityslot"
        )
        assert sorted(per_row.values_list("action", flat=True)) == ["create", "update"]
        assert AuditLog.objects.filter(object_type="import:bookings.slots").exists()

    def test_capacity_below_booked_is_an_error_and_valid_only_commit(self, admin_client):
        d = _future().strftime("%d/%m/%Y")
        slot = _slot(days=10, capacity=5)
        _booking(slot, "A", attendees=3)
        text = self._csv(
            f"individual,{d},09:00,09:30,2,Campus",
            f"individual,{d},13:00,13:30,1,Campus",
        )
        resp = self._post(admin_client, text, dry_run="0")
        assert resp.status_code == 400  # error rows block a plain commit
        resp = self._post(admin_client, text, dry_run="0", valid_only="1")
        assert resp.status_code == 200
        assert resp.data["counts"] == {"crear": 1, "actualizar": 0, "omitir": 0, "error": 1}
        slot.refresh_from_db()
        assert slot.capacity == 5

    def test_error_report_csv(self, admin_client):
        text = self._csv("individual,31/02/2027,09:00,09:30,1,Campus")
        resp = self._post(admin_client, text, report="csv")
        body = _body(resp)
        assert body.splitlines()[0].endswith("fila,resultado,errores,avisos")
        assert "error" in body.splitlines()[1] and "fecha" in body.splitlines()[1]

    def test_missing_required_header_is_400(self, admin_client):
        resp = self._post(admin_client, "tipo,fecha\nindividual,01/01/2030\n")
        assert resp.status_code == 400 and "inicio" in resp.data["detail"]

    def test_parse_hhmm(self):
        assert parse_hhmm("9:05") == time(9, 5)
        assert parse_hhmm("09.30") == time(9, 30)
        assert parse_hhmm("10:00:00") == time(10)
        with pytest.raises(ValueError):
            parse_hhmm("25:00")
