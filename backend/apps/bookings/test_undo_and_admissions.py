"""Owner 2026-11-26: «Deshacer cancelación» and «Pasar a Admisiones» in Visitas.

The owner cancelled three visits of one family (each cancel emails the family)
and had no way back but «Reabrir» (to «Pendiente», silent). Families that book
on the website had no admissions case, so the office could not start the
process from the visit.
"""

import datetime as dt

import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.models import User
from apps.admissions.models import PreRegistration
from apps.bookings.data_ops import BOOKING_BULK_ACTIONS
from apps.bookings.models import AvailabilitySlot, Booking, VisitType
from apps.bookings.serializers import AdminBookingSerializer, BookingSerializer
from apps.bookings.services.ics import build_ics
from apps.core.bulk import BulkSkip
from apps.core.models import AuditLog


def _slot(days=3, hour=9, capacity=2):
    return AvailabilitySlot.objects.create(
        visit_type=VisitType.INDIVIDUAL,
        date=dt.date.today() + dt.timedelta(days=days),
        start_time=dt.time(hour, 0),
        end_time=dt.time(hour + 1, 0),
        capacity=capacity,
    )


def _booking(slot=None, **kw):
    data = dict(
        parent_name="María López",
        parent_email="maria@test.mx",
        parent_phone="5512345678",
        child_name="Ana López",
        child_grade="1° primaria",
        status=Booking.Status.CONFIRMED,
        confirmation_sent=True,
    )
    data.update(kw)
    return Booking.objects.create(slot=slot or _slot(), **data)


def _last_audit(obj, object_type="bookings.booking"):
    return AuditLog.objects.filter(object_type=object_type, object_id=str(obj.pk)).latest("pk")


@pytest.fixture(autouse=True)
def _locmem(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"


def _staff(email, areas):
    return User.objects.create_user(
        email=email,
        password="x-Strong-pass-2026",
        first_name="Paty",
        role=User.Role.STAFF,
        staff_areas=areas,
    )


# ── A. «Deshacer cancelación» ──────────────────────────────────────────────
@pytest.mark.django_db
def test_uncancel_puts_the_visit_back_and_tells_the_family(
    admin_client, django_capture_on_commit_callbacks
):
    b = _booking(status=Booking.Status.CANCELLED)
    with django_capture_on_commit_callbacks(execute=True):
        r = admin_client.post(
            reverse("bookings-admin-action", args=[b.pk, "uncancel"]), {}, format="json"
        )
    assert r.status_code == 200 and r.data["status"] == "confirmed"
    sent = [m for m in mail.outbox if m.to == ["maria@test.mx"]]
    assert len(sent) == 1 and sent[0].subject.startswith("Su visita sigue en pie")
    name, ics, mimetype = sent[0].attachments[0]
    # The same event, republished above the cancellation's SEQUENCE 1.
    assert name == "visita-interlaken.ics" and "method=PUBLISH" in mimetype
    assert f"UID:booking-{b.pk}@interlaken.edu.mx" in ics and "SEQUENCE:2" in ics
    assert "STATUS:CONFIRMED" in ics and "METHOD:PUBLISH" in ics
    audit = _last_audit(b)
    assert audit.context == "bookings: deshacer cancelación"
    assert (
        audit.changes["status"] == ["cancelled", "confirmed"]
        and audit.changes["family_notified"] is True
    )


@pytest.mark.django_db
def test_uncancel_quietly_sends_nothing(admin_client, django_capture_on_commit_callbacks):
    b = _booking(status=Booking.Status.CANCELLED)
    with django_capture_on_commit_callbacks(execute=True):
        r = admin_client.post(
            reverse("bookings-admin-action", args=[b.pk, "uncancel"]),
            {"notify": False, "note": "Se canceló por error"},
            format="json",
        )
    assert r.status_code == 200 and r.data["status"] == "confirmed"
    assert mail.outbox == []
    audit = _last_audit(b)
    assert (
        audit.changes["family_notified"] is False
        and audit.changes["note"] == "Se canceló por error"
    )


@pytest.mark.django_db
def test_uncancel_refused_once_the_visit_passed(admin_client):
    b = _booking(_slot(days=-1), status=Booking.Status.CANCELLED)
    r = admin_client.post(
        reverse("bookings-admin-action", args=[b.pk, "uncancel"]), {}, format="json"
    )
    assert r.status_code == 400 and "ya pasó" in str(r.data)
    b.refresh_from_db()
    assert b.status == "cancelled"


@pytest.mark.django_db
def test_uncancel_refused_when_the_seat_was_taken(admin_client):
    slot = _slot(capacity=1)
    b = _booking(slot, status=Booking.Status.CANCELLED)
    _booking(slot, parent_email="otra@test.mx")
    r = admin_client.post(
        reverse("bookings-admin-action", args=[b.pk, "uncancel"]), {}, format="json"
    )
    assert r.status_code == 400 and "cupo" in str(r.data)
    b.refresh_from_db()
    assert b.status == "cancelled"


@pytest.mark.django_db
def test_uncancel_only_for_a_cancelled_visit(admin_client):
    b = _booking()
    r = admin_client.post(
        reverse("bookings-admin-action", args=[b.pk, "uncancel"]), {}, format="json"
    )
    assert r.status_code == 400 and "cancelada" in str(r.data)


@pytest.mark.django_db
def test_cancel_quietly_records_that_the_family_was_not_told(
    admin_client, django_capture_on_commit_callbacks
):
    b = _booking()
    with django_capture_on_commit_callbacks(execute=True):
        r = admin_client.post(
            reverse("bookings-admin-action", args=[b.pk, "cancel"]),
            {"notify": False},
            format="json",
        )
    assert r.status_code == 200 and r.data["status"] == "cancelled"
    assert mail.outbox == []
    assert _last_audit(b).changes["family_notified"] is False


@pytest.mark.django_db
def test_bulk_confirm_never_revives_a_cancelled_visit():
    b = _booking(status=Booking.Status.CANCELLED)
    confirm = BOOKING_BULK_ACTIONS["confirm"]
    with pytest.raises(BulkSkip):
        confirm.plan(b, {})
    with pytest.raises(BulkSkip):
        confirm.handler(b, {}, None)
    b.refresh_from_db()
    assert b.status == "cancelled"


@pytest.mark.django_db
def test_ics_sequences_publish_cancel_restore():
    b = _booking()
    assert "SEQUENCE:0" in build_ics(b) and "METHOD:PUBLISH" in build_ics(b)
    cancel = build_ics(b, cancel=True)
    assert "SEQUENCE:1" in cancel and "METHOD:CANCEL" in cancel and "STATUS:CANCELLED" in cancel
    restore = build_ics(b, restore=True)
    assert "SEQUENCE:2" in restore and "METHOD:PUBLISH" in restore and "STATUS:CONFIRMED" in restore


# ── B. «Pasar a Admisiones» ────────────────────────────────────────────────
def _url(b):
    return reverse("bookings-admin-admissions", args=[b.pk])


PROSPECT = {
    "child_name": "Ana López",
    "parent_name": "María López",
    "parent_phone": "5512345678",
    "parent_email": "maria@test.mx",
    "grade_applying": "1° Primaria",
    "cycle": "proximo",
}


@pytest.mark.django_db
def test_get_prefills_from_the_booking_and_lists_duplicates(admin_client):
    b = _booking()
    twin = PreRegistration.objects.create(
        child_first_name="Ana",
        child_last_name="López",
        level="primaria",
        grade_applying="1° Primaria",
        parent_name="María",
        parent_email="MARIA@test.mx",
        parent_phone="5599999999",
    )
    r = admin_client.get(_url(b))
    assert r.status_code == 200 and r.data["case"] is None
    assert r.data["prefill"]["grade_applying"] == "1° Primaria"
    assert (
        r.data["prefill"]["child_name"] == "Ana López"
        and r.data["prefill"]["parent_phone"] == "5512345678"
    )
    assert [d["id"] for d in r.data["duplicates"]] == [twin.pk]


@pytest.mark.django_db
def test_post_creates_the_case_in_visita_guiada_and_links_the_visit(admin_client):
    b = _booking()
    r = admin_client.post(_url(b), PROSPECT, format="json")
    assert r.status_code == 201 and r.data["created"] is True
    assert r.data["case"]["stage"] == "visita"
    b.refresh_from_db()
    lead = PreRegistration.objects.get(pk=r.data["case"]["id"])
    assert (
        b.pre_registration_id == lead.pk
        and lead.stage == "visita"
        and lead.grade_applying == "1° Primaria"
    )
    assert _last_audit(b).context == "bookings: pasar a admisiones"
    assert AuditLog.objects.filter(
        object_type="admissions.preregistration", object_id=str(lead.pk), action="create"
    ).exists()
    # The list now names the case: «Ver expediente» instead of the button.
    row = admin_client.get(reverse("bookings-admin-list")).data["results"][0]
    assert row["admissions_case"] == {
        "id": lead.pk,
        "stage": "visita",
        "stage_label": "Visita guiada",
    }
    again = admin_client.get(_url(b))
    assert again.data["case"]["id"] == lead.pk and again.data["duplicates"] == []


@pytest.mark.django_db
def test_post_applies_a_result_already_recorded_on_the_visit(admin_client):
    b = _booking(_slot(days=-1), status=Booking.Status.ATTENDED, outcome=Booking.Outcome.ENROLLING)
    r = admin_client.post(_url(b), PROSPECT, format="json")
    assert r.status_code == 201 and r.data["case"]["stage"] == "examen"


@pytest.mark.django_db
def test_post_from_a_cancelled_visit_stays_in_informes(admin_client):
    b = _booking(status=Booking.Status.CANCELLED)
    r = admin_client.post(_url(b), PROSPECT, format="json")
    assert r.status_code == 201 and r.data["case"]["stage"] == "informes"


@pytest.mark.django_db
def test_post_links_an_existing_case_forward_only(admin_client):
    b = _booking()
    lead = PreRegistration.objects.create(
        child_first_name="Ana",
        child_last_name="López",
        level="primaria",
        grade_applying="1° Primaria",
        parent_name="María",
        parent_email="maria@test.mx",
        parent_phone="5512345678",
    )
    r = admin_client.post(_url(b), {"link_to": lead.pk}, format="json")
    assert (
        r.status_code == 200 and r.data["created"] is False and r.data["case"]["stage"] == "visita"
    )
    b.refresh_from_db()
    assert b.pre_registration_id == lead.pk
    # Already in «Examen»: linking another visit never pulls it back.
    later = _booking(_slot(hour=11), parent_email="maria@test.mx")
    PreRegistration.objects.filter(pk=lead.pk).update(stage="examen")
    r = admin_client.post(_url(later), {"link_to": lead.pk}, format="json")
    assert r.status_code == 200 and r.data["case"]["stage"] == "examen"


@pytest.mark.django_db
def test_post_refuses_a_second_case_and_bad_input(admin_client):
    b = _booking()
    assert admin_client.post(_url(b), PROSPECT, format="json").status_code == 201
    r = admin_client.post(_url(b), PROSPECT, format="json")
    assert r.status_code == 409 and r.data["case"]["stage"] == "visita"
    assert PreRegistration.objects.count() == 1
    other = _booking(_slot(hour=11), parent_email="otra@test.mx", parent_phone="5587654321")
    assert admin_client.post(_url(other), {"link_to": "x"}, format="json").status_code == 400
    assert admin_client.post(_url(other), {"link_to": 999999}, format="json").status_code == 400
    bad = admin_client.post(_url(other), {**PROSPECT, "grade_applying": ""}, format="json")
    assert bad.status_code == 400 and "grade_applying" in bad.data
    other.refresh_from_db()
    assert other.pre_registration_id is None


@pytest.mark.django_db
def test_areas_visitas_or_admisiones(api_client):
    b = _booking()
    api_client.force_authenticate(_staff("caja@test.mx", ["cafeteria"]))
    assert api_client.get(_url(b)).status_code == 403
    api_client.force_authenticate(_staff("recepcion@test.mx", ["visitas"]))
    assert api_client.get(_url(b)).status_code == 200
    assert api_client.post(_url(b), PROSPECT, format="json").status_code == 201


def test_public_booking_answers_never_name_the_case():
    assert "admissions_case" not in BookingSerializer.Meta.fields
    assert "admissions_case" in AdminBookingSerializer.Meta.fields
