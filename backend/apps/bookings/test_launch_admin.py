"""Pre-launch admin review (2026-11-09): Visitas.

- Any staff account (a cafetería cashier) could read and cancel any booking
  through the family endpoints, with no audit row. Staff now need «visitas».
- Bulk confirm emailed (and synced the calendar) inside the chunk's
  transaction: now once the chunk is committed, in chunks of 10.
"""

from datetime import time, timedelta

import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import UserFactory
from apps.accounts.models import User
from apps.bookings.models import AvailabilitySlot, Booking, VisitType
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db
S = Booking.Status


@pytest.fixture(autouse=True)
def _locmem(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"


def _slot(capacity=20):
    return AvailabilitySlot.objects.create(
        visit_type=VisitType.INDIVIDUAL,
        date=timezone.localdate() + timedelta(days=3),
        start_time=time(9, 0),
        end_time=time(9, 30),
        capacity=capacity,
    )


def _booking(slot, name="Ana", status=S.CONFIRMED):
    return Booking.objects.create(
        slot=slot,
        parent_name=name,
        status=status,
        num_attendees=1,
        parent_email=f"{name.lower()}@test.mx",
        parent_phone="5512345678",
    )


def _staff(*areas):
    return UserFactory(role=User.Role.STAFF, staff_areas=list(areas))


class TestStaffNeedTheVisitasArea:
    def test_a_cashier_cannot_read_or_cancel_a_booking(self, api_client):
        booking = _booking(_slot())
        api_client.force_authenticate(_staff("cafeteria"))
        assert api_client.get(reverse("bookings-detail", args=[booking.pk])).status_code == 404
        assert api_client.post(reverse("bookings-cancel", args=[booking.pk])).status_code == 404
        booking.refresh_from_db()
        assert booking.status == S.CONFIRMED

    def test_visitas_staff_cancel_and_it_is_audited(self, api_client):
        booking = _booking(_slot())
        staff = _staff("visitas")
        api_client.force_authenticate(staff)
        assert api_client.get(reverse("bookings-detail", args=[booking.pk])).status_code == 200
        r = api_client.post(reverse("bookings-cancel", args=[booking.pk]))
        assert r.status_code == 200
        row = AuditLog.objects.get(context="bookings: cancelación")
        assert row.actor_id == staff.pk and row.changes["status"] == [S.CONFIRMED, S.CANCELLED]

    def test_the_family_still_cancels_its_own(self, api_client):
        booking = _booking(_slot(), name="Mama")
        api_client.force_authenticate(UserFactory(email="mama@test.mx"))
        assert api_client.post(reverse("bookings-cancel", args=[booking.pk])).status_code == 200


class TestBulkConfirm:
    def test_confirmations_go_out_after_their_chunk(self, admin_client, monkeypatch):
        from apps.bookings.services import status as status_mod

        slot = _slot()
        ids = [_booking(slot, name=f"N{i}", status=S.PENDING).pk for i in range(12)]
        confirmed_when_sent = []
        real = status_mod.send_booking_confirmation

        def spy(booking):
            confirmed_when_sent.append(
                Booking.objects.filter(pk__in=ids, status=S.CONFIRMED).count()
            )
            return real(booking)

        monkeypatch.setattr(status_mod, "send_booking_confirmation", spy)
        mail.outbox.clear()
        r = admin_client.post(
            reverse("bookings-admin-bulk"), {"action": "confirm", "ids": ids}, format="json"
        )

        assert r.data["ok"] == 12 and len(mail.outbox) == 12
        assert confirmed_when_sent[:10] == [10] * 10 and confirmed_when_sent[10:] == [12, 12]
        assert Booking.objects.filter(pk__in=ids, confirmation_sent=True).count() == 12

    def test_a_single_confirm_still_emails_right_away(self, admin_client):
        booking = _booking(_slot(), status=S.PENDING)
        mail.outbox.clear()
        r = admin_client.post(
            reverse("bookings-admin-action", args=[booking.pk, "confirm"]), {}, format="json"
        )
        assert r.status_code == 200 and len(mail.outbox) == 1
