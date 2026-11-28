"""One standing visit per family (owner 2026-11-26).

A family booked three visits with the same email in two days; the school
cancelled two, and each cancellation emailed the family. Every public entry
point (web form, «Puertas Abiertas» signup, WhatsApp bot) now refuses a second
visit of the same type while one is still to come, and says which one.
"""

import datetime as dt

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.bookings.models import AvailabilitySlot, Booking, VisitType
from apps.bookings.services import AlreadyBooked, create_booking
from apps.bookings.services.booking import already_booked_message, find_standing_booking

pytestmark = pytest.mark.django_db


def _slot(days=3, hour=11, minute=45, visit_type=VisitType.INDIVIDUAL, capacity=2):
    return AvailabilitySlot.objects.create(
        visit_type=visit_type,
        date=timezone.localdate() + dt.timedelta(days=days),
        start_time=dt.time(hour, minute),
        end_time=dt.time(hour + 1, minute),
        capacity=capacity,
    )


def _book(
    slot, email="familia@escuela.test", phone="55 1234 5678", status=Booking.Status.CONFIRMED
):
    return Booking.objects.create(
        slot=slot,
        parent_name="Familia Pérez",
        parent_email=email,
        parent_phone=phone,
        status=status,
    )


def _web(api_client, slot, email="familia@escuela.test", phone="5512345678"):
    return api_client.post(
        reverse("bookings-create"),
        {
            "slot": slot.pk,
            "parent_name": "Familia Pérez",
            "parent_email": email,
            "parent_phone": phone,
            "num_attendees": 1,
        },
        format="json",
    )


class TestWebForm:
    def test_second_visit_with_the_same_email_is_refused_with_the_first_one(self, api_client):
        first = _slot(days=5)
        _book(first)
        resp = _web(api_client, _slot(days=6), email="  FAMILIA@Escuela.test ", phone="5599990000")
        assert resp.status_code == 409
        assert resp.data["code"] == "already_booked"
        assert resp.data["existing"] == {
            "date": first.date.isoformat(),
            "start_time": "11:45",
            "visit_type": "individual",
            "visit_type_label": "Visita Individual",
        }
        assert resp.data["detail"].startswith("Ya tiene una visita agendada el ")
        assert "a las 11:45 (Visita Individual)" in resp.data["detail"]
        assert "escríbanos por WhatsApp o llame al colegio" in resp.data["detail"]
        assert Booking.objects.count() == 1

    @pytest.mark.parametrize("phone", ["5512345678", "+52 1 55 1234 5678", "(55) 1234-5678"])
    def test_the_same_phone_written_another_way_is_the_same_family(self, api_client, phone):
        _book(_slot(days=5), email="otra@escuela.test", phone="55 1234 5678")
        resp = _web(api_client, _slot(days=6), email="distinta@escuela.test", phone=phone)
        assert resp.status_code == 409
        assert resp.data["code"] == "already_booked"

    @pytest.mark.parametrize(
        "status", [Booking.Status.CANCELLED, Booking.Status.ATTENDED, Booking.Status.NO_SHOW]
    )
    def test_a_closed_visit_never_blocks(self, api_client, status):
        _book(_slot(days=5), status=status)
        assert _web(api_client, _slot(days=6)).status_code == 201

    def test_a_past_visit_never_blocks(self, api_client):
        _book(_slot(days=-2))
        assert _web(api_client, _slot(days=6)).status_code == 201

    def test_a_visit_that_already_started_today_never_blocks(self, api_client):
        _book(_slot(days=0, hour=0, minute=0))
        assert _web(api_client, _slot(days=6)).status_code == 201

    def test_another_family_books_normally(self, api_client):
        _book(_slot(days=5))
        resp = _web(api_client, _slot(days=6), email="otra@escuela.test", phone="5588887777")
        assert resp.status_code == 201

    def test_a_pending_visit_also_counts(self, api_client):
        _book(_slot(days=5), status=Booking.Status.PENDING)
        assert _web(api_client, _slot(days=6)).status_code == 409


class TestOtherEntryPoints:
    def test_open_school_signup_refuses_a_second_open_class(self, api_client):
        first = _slot(days=5, visit_type=VisitType.OPEN_CLASS, capacity=30)
        _book(first)
        second = _slot(days=12, visit_type=VisitType.OPEN_CLASS, capacity=30)
        resp = api_client.post(
            reverse("open-school-signup"),
            {
                "slot": second.pk,
                "parent_name": "Familia Pérez",
                "parent_email": "familia@escuela.test",
                "parent_phone": "5512345678",
                "num_attendees": 2,
            },
            format="json",
        )
        assert resp.status_code == 409
        assert resp.data["code"] == "already_booked"
        assert resp.data["existing"]["visit_type"] == "open_class"

    def test_an_individual_visit_does_not_block_puertas_abiertas(self, api_client):
        _book(_slot(days=5))
        event = _slot(days=12, visit_type=VisitType.OPEN_CLASS, capacity=30)
        resp = api_client.post(
            reverse("open-school-signup"),
            {
                "slot": event.pk,
                "parent_name": "Familia Pérez",
                "parent_email": "familia@escuela.test",
                "parent_phone": "5512345678",
                "num_attendees": 2,
            },
            format="json",
        )
        assert resp.status_code == 201

    def test_whatsapp_answers_with_the_same_visit_and_books_nothing(self, monkeypatch):
        from apps.whatsapp import services as wa

        sent = []
        monkeypatch.setattr(wa, "send_text", lambda to, text: sent.append(text))
        first = _slot(days=5)
        _book(first, email="", phone="5512345678")
        outcome = wa._book_slot("5215512345678", "Familia", str(_slot(days=6).pk))
        assert outcome == "already-booked"
        assert Booking.objects.count() == 1
        assert sent and sent[-1].startswith("Ya tiene una visita agendada el ")
        assert "respóndanos por este medio" in sent[-1]

    def test_staff_may_book_a_second_one_on_purpose(self):
        _book(_slot(days=5))
        booking = create_booking(
            slot_id=_slot(days=6).pk,
            parent_name="Familia Pérez",
            parent_email="familia@escuela.test",
            parent_phone="5512345678",
            source=Booking.Source.ADMIN,
            notify_email=False,
            allow_duplicate=True,
        )
        assert booking.pk and Booking.objects.count() == 2


class TestMatching:
    def test_the_retention_placeholder_and_blank_contact_match_nothing(self):
        _book(_slot(days=5), email="[eliminado por retención]", phone="")
        assert (
            find_standing_booking(
                email="[eliminado por retención]", phone="", visit_type=VisitType.INDIVIDUAL
            )
            is None
        )
        assert find_standing_booking(email="", phone="12", visit_type=VisitType.INDIVIDUAL) is None

    def test_create_booking_raises_with_the_existing_visit(self):
        existing = _book(_slot(days=5))
        with pytest.raises(AlreadyBooked) as exc:
            create_booking(
                slot_id=_slot(days=6).pk,
                parent_name="Familia",
                parent_email="familia@escuela.test",
                notify_email=False,
            )
        assert exc.value.existing == existing

    def test_the_message_names_the_weekday_day_month_and_time(self):
        slot = AvailabilitySlot.objects.create(
            visit_type=VisitType.INDIVIDUAL,
            date=dt.date(2026, 12, 3),
            start_time=dt.time(11, 45),
            end_time=dt.time(12, 30),
            capacity=1,
        )
        booking = _book(slot)
        assert already_booked_message(booking) == (
            "Ya tiene una visita agendada el jueves 3 de diciembre a las 11:45 (Visita Individual). "
            "Si desea cambiarla, escríbanos por WhatsApp o llame al colegio."
        )
