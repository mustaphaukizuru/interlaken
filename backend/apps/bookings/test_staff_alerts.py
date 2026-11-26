"""Owner points 2026-11-25: the school hears about every visit a family books or
cancels (email to the admissions inbox and the Visitas staff, a bell for every
administrator and Visitas staff account), after the commit, and an alert
problem never touches the booking."""

from datetime import time, timedelta

import pytest
from django.core import mail
from django.db import transaction
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, UserFactory
from apps.accounts.models import User
from apps.portal import services as portal_services
from apps.portal.models import Notification

from .models import AvailabilitySlot, Booking, VisitType
from .services import create_booking, staff_alerts
from .services.staff_alerts import alert_emails, new_booking_content

pytestmark = pytest.mark.django_db

INBOX = "info@escuela.test"


@pytest.fixture(autouse=True)
def _mail_and_sync_background(settings, monkeypatch):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.ADMISSIONS_EMAIL = INBOX
    settings.CONTACT_EMAIL = "contacto@escuela.test"
    settings.FRONTEND_URL = "https://escuela.test"
    # The alert runs on a background thread in production; here, inline.
    monkeypatch.setattr(portal_services, "run_in_background", lambda fn, *, name: fn())


@pytest.fixture
def people():
    """Who is told and who is not."""
    admin = AdminFactory(email="direccion@escuela.test")
    visitas = UserFactory(
        role=User.Role.STAFF, staff_areas=["admisiones", "visitas"], email="pmaya@escuela.test"
    )
    cashier = UserFactory(
        role=User.Role.STAFF, staff_areas=["cafeteria"], email="caja@escuela.test"
    )
    gone = UserFactory(
        role=User.Role.STAFF, staff_areas=["visitas"], email="baja@escuela.test", is_active=False
    )
    parent = ParentFactory(email="familia@escuela.test")
    return {"admin": admin, "visitas": visitas, "cashier": cashier, "gone": gone, "parent": parent}


def _slot(days=3, hour=11, visit_type=VisitType.INDIVIDUAL, **kw):
    return AvailabilitySlot.objects.create(
        visit_type=visit_type,
        date=timezone.localdate() + timedelta(days=days),
        start_time=time(hour, 0),
        end_time=time(hour, 45),
        capacity=kw.pop("capacity", 4),
        **kw,
    )


def _school_alerts():
    return [m for m in mail.outbox if m.subject.startswith(("Nueva visita", "Visita cancelada"))]


def _bells(user):
    return list(Notification.objects.filter(user=user).values_list("title", "message"))


def _book_on_the_site(api_client, slot, **overrides):
    body = {
        "slot": slot.pk,
        "parent_name": "Ana López",
        "parent_email": "familia@escuela.test",
        "parent_phone": "5512345678",
        "child_name": "Pedro",
        "child_grade": "3° Primaria",
        "num_attendees": 2,
        **overrides,
    }
    return api_client.post(reverse("bookings-create"), body, format="json")


class TestNewBooking:
    def test_web_booking_tells_the_inbox_the_visitas_staff_and_every_admin(
        self, api_client, people, django_capture_on_commit_callbacks
    ):
        slot = _slot()
        with django_capture_on_commit_callbacks(execute=True):
            resp = _book_on_the_site(api_client, slot)
        assert resp.status_code == 201

        family = [m for m in mail.outbox if m.to == ["familia@escuela.test"]]
        assert len(family) == 1  # the family's own confirmation, unchanged
        [alert] = _school_alerts()
        # One email: the admissions inbox first, then the Visitas staff (never the
        # cashier, never an inactive account), each once.
        assert alert.to == [INBOX, "pmaya@escuela.test"]
        assert alert.reply_to == ["familia@escuela.test"]  # «Responder» writes to the family
        day = slot.date
        assert alert.subject.startswith("Nueva visita: ")
        assert f"{day.day} de " in alert.subject and "11:00" in alert.subject
        assert "Ana" not in alert.subject  # names stay out of lock screens
        for text in (
            "Ana López",
            "5512345678",
            "familia@escuela.test",
            "Pedro (3° Primaria)",
            "Quedó confirmada automáticamente",
            "Tipo de visita: Visita Individual",
            f"/admin/visitas?desde={day.isoformat()}",
        ):
            assert text in alert.body, text
        assert "—" not in alert.body

        # Bells: every admin and the Visitas staff; nobody else.
        for who in ("admin", "visitas"):
            [(title, message)] = _bells(people[who])
            assert title == alert.subject
            assert "Familia: Ana López" in message and "Asistentes: 2" in message
            assert f"https://escuela.test/admin/visitas?desde={day.isoformat()}" in message
        for who in ("cashier", "gone", "parent"):
            assert _bells(people[who]) == []
        # The bell is not a second email for the admin.
        assert not [m for m in mail.outbox if "direccion@escuela.test" in m.to]

    def test_whatsapp_booking_is_announced_without_a_family_email(
        self, people, django_capture_on_commit_callbacks
    ):
        slot = _slot()
        with django_capture_on_commit_callbacks(execute=True):
            create_booking(
                slot_id=slot.pk,
                parent_name="Familia (WhatsApp)",
                parent_email="",
                parent_phone="5215512345678",
                source=Booking.Source.WHATSAPP,
                notify_email=False,
            )
        [alert] = mail.outbox  # no family email: WhatsApp confirms in-channel
        assert alert.to == [INBOX, "pmaya@escuela.test"]
        assert alert.reply_to == ["contacto@escuela.test"]  # the default, not an empty one
        assert "se le confirmó a la familia por WhatsApp" in alert.body
        assert "La familia no dejó correo" in alert.body
        assert "Origen: WhatsApp" in _bells(people["admin"])[0][1]

    def test_open_school_signup_is_announced_too(
        self, api_client, people, django_capture_on_commit_callbacks
    ):
        slot = _slot(
            visit_type=VisitType.OPEN_CLASS, capacity=30, title="Puertas Abiertas diciembre"
        )
        with django_capture_on_commit_callbacks(execute=True):
            resp = api_client.post(
                reverse("open-school-signup"),
                {
                    "slot": slot.pk,
                    "parent_name": "Marta Ruiz",
                    "parent_email": "marta@escuela.test",
                    "parent_phone": "5511112222",
                    "num_attendees": 3,
                },
                format="json",
            )
        assert resp.status_code == 201, resp.data
        [alert] = _school_alerts()
        assert "Tipo de visita: Clase Abierta / Puertas Abiertas (Puertas Abiertas diciembre)" in alert.body
        assert "Asistentes: 3" in alert.body

    def test_the_alert_waits_for_the_commit(self, people, django_capture_on_commit_callbacks):
        slot = _slot()
        with django_capture_on_commit_callbacks(execute=False) as callbacks:
            create_booking(
                slot_id=slot.pk,
                parent_name="Ana López",
                parent_email="familia@escuela.test",
                parent_phone="5512345678",
            )
            assert _school_alerts() == []  # nothing before the commit
        assert len(callbacks) == 1

    def test_a_rolled_back_booking_tells_nobody(self, people, django_capture_on_commit_callbacks):
        slot = _slot()
        with django_capture_on_commit_callbacks(execute=True) as callbacks:
            with pytest.raises(RuntimeError), transaction.atomic():
                create_booking(
                    slot_id=slot.pk,
                    parent_name="Ana López",
                    parent_email="",
                    parent_phone="5512345678",
                )
                raise RuntimeError("the outer request failed")
        assert callbacks == [] and _school_alerts() == []
        assert not Notification.objects.exists()

    def test_a_mail_or_bell_failure_never_fails_the_booking(
        self, api_client, people, monkeypatch, django_capture_on_commit_callbacks
    ):
        def boom(*args, **kwargs):
            raise RuntimeError("SMTP down")

        monkeypatch.setattr(portal_services, "send_email", boom)
        monkeypatch.setattr(portal_services, "notify", boom)
        with django_capture_on_commit_callbacks(execute=True):
            resp = _book_on_the_site(api_client, _slot())
        assert resp.status_code == 201
        assert Booking.objects.count() == 1

    def test_one_failed_bell_does_not_stop_the_others(self, people, monkeypatch):
        real_notify = portal_services.notify

        def flaky(user, *args, **kwargs):
            if user.pk == people["admin"].pk:
                raise RuntimeError("push service down")
            return real_notify(user, *args, **kwargs)

        monkeypatch.setattr(portal_services, "notify", flaky)
        booking = Booking.objects.create(
            slot=_slot(),
            parent_name="Ana López",
            parent_phone="5512345678",
            parent_email="familia@escuela.test",
        )
        assert staff_alerts.notify_staff(booking.pk) == 3  # 2 addresses + the Visitas staff bell
        assert len(_bells(people["visitas"])) == 1


class TestFamilyCancellation:
    def _booking(self):
        return Booking.objects.create(
            slot=_slot(),
            parent_name="Ana López",
            parent_phone="5512345678",
            parent_email="familia@escuela.test",
        )

    def test_the_family_cancelling_tells_the_school(
        self, api_client, people, django_capture_on_commit_callbacks
    ):
        booking = self._booking()
        api_client.force_authenticate(user=people["parent"])
        with django_capture_on_commit_callbacks(execute=True):
            resp = api_client.post(reverse("bookings-cancel", args=[booking.pk]))
        assert resp.status_code == 200 and resp.data["status"] == "cancelled"
        [alert] = _school_alerts()
        assert alert.subject.startswith("Visita cancelada: ")
        assert alert.to == [INBOX, "pmaya@escuela.test"]
        assert "canceló su visita" in alert.body and "El horario quedó libre" in alert.body
        [(title, _message)] = _bells(people["admin"])
        assert title == alert.subject

    @pytest.mark.parametrize("who", ["admin", "visitas"])
    def test_staff_cancelling_needs_no_alert(
        self, api_client, people, who, django_capture_on_commit_callbacks
    ):
        booking = self._booking()
        api_client.force_authenticate(user=people[who])
        with django_capture_on_commit_callbacks(execute=True):
            resp = api_client.post(reverse("bookings-cancel", args=[booking.pk]))
        assert resp.status_code == 200
        assert _school_alerts() == [] and not Notification.objects.exists()


class TestRecipientsAndContent:
    def test_each_address_once_and_the_contact_inbox_as_fallback(self, settings, people):
        people["visitas"].email = "INFO@escuela.test"  # same mailbox as the inbox
        people["visitas"].save(update_fields=["email"])
        assert alert_emails() == [INBOX]
        settings.ADMISSIONS_EMAIL = ""
        assert alert_emails() == ["contacto@escuela.test", "INFO@escuela.test"]

    def test_archived_staff_are_not_told(self, people):
        people["visitas"].archived_at = timezone.now()
        people["visitas"].save(update_fields=["archived_at"])
        assert alert_emails() == [INBOX]

    def test_subject_is_short_and_nameless(self):
        slot = AvailabilitySlot(
            date=timezone.localdate() + timedelta(days=3),
            start_time=time(9),
            end_time=time(10),
            capacity=1,
        )
        booking = Booking(
            slot=slot,
            parent_name="Sofía Prueba",
            parent_email="s@escuela.test",
            parent_phone="5555555555",
            notes="x" * 400,
        )
        subject, content = new_booking_content(booking)
        assert len(subject) <= 50 and "Sofía" not in subject
        notes = dict(content.details)["Notas"]
        assert len(notes) == 300 and notes.endswith("…")
