"""Builders shared by the Expediente tests (``test_process_*.py``). Synthetic data only."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.factories import UserFactory
from apps.accounts.models import User

from .models import AdmissionDiscount, EnrollmentPayment, PreRegistration, Registration


def make_lead(**kw) -> PreRegistration:
    data = dict(
        child_first_name="Lucía",
        child_last_name="Prueba Ejemplo",
        level="primaria",
        grade_applying="2° Primaria",
        cycle="2027-2028",
        parent_name="Marta Ejemplo",
        parent_email="marta@ejemplo.test",
        parent_phone="5512345678",
    )
    data.update(kw)
    return PreRegistration.objects.create(**data)


def at_stage(lead, stage, **extra) -> PreRegistration:
    """Put a lead on ``stage`` directly (status kept in sync), for setting up a test."""
    from .process import STAGE_STATUS

    fields = {"stage": stage, "status": STAGE_STATUS[stage], **extra}
    PreRegistration.objects.filter(pk=lead.pk).update(**fields)
    lead.refresh_from_db()
    return lead


def admitted(lead, **extra) -> PreRegistration:
    """The exam is «Aceptado» (stage «Documentación y acuerdos»): the ficha link may go out."""
    return at_stage(
        lead,
        PreRegistration.Stage.DOCUMENTACION,
        exam_at=extra.pop("exam_at", None) or future(-2),
        exam_result=PreRegistration.ExamResult.ACEPTADO,
        **extra,
    )


def make_registration(lead, status=Registration.Status.SUBMITTED, **kw) -> Registration:
    data = dict(
        pre_registration=lead,
        child_first_name=lead.child_first_name,
        child_last_name=lead.child_last_name,
        child_dob=dt.date(2019, 3, 4),
        level=lead.level,
        grade_applying=lead.grade_applying,
        cycle=lead.cycle,
        parent1_name=lead.parent_name,
        parent1_email=lead.parent_email,
        parent1_phone=lead.parent_phone,
        status=status,
        ficha_version=Registration.FichaVersion.FICHA,
    )
    data.update(kw)
    return Registration.objects.create(**data)


def make_payment(lead, **kw) -> EnrollmentPayment:
    data = dict(
        pre_registration=lead,
        paid_on=timezone.localdate(),
        amount=Decimal("9500.00"),
        method=EnrollmentPayment.Method.TRANSFERENCIA,
        reference="REF-001",
    )
    data.update(kw)
    return EnrollmentPayment.objects.create(**data)


def make_discount(lead, **kw) -> AdmissionDiscount:
    data = dict(
        pre_registration=lead,
        kind=AdmissionDiscount.Kind.BECA_COLEGIATURA,
        percent=Decimal("20"),
        duration=AdmissionDiscount.Duration.CICLO,
        authorized_by="Dirección",
    )
    data.update(kw)
    return AdmissionDiscount.objects.create(**data)


def staff_client(*areas) -> APIClient:
    user = UserFactory(role=User.Role.STAFF, staff_areas=list(areas))
    client = APIClient()
    client.force_authenticate(user=user)
    client.user = user
    return client


def aware(year, month, day, hour=9, minute=0):
    return timezone.make_aware(dt.datetime(year, month, day, hour, minute))


def future(days=7, hour=9):
    d = timezone.localdate() + dt.timedelta(days=days)
    return timezone.make_aware(dt.datetime(d.year, d.month, d.day, hour, 0))


def make_slot(days=3, hour=10, capacity=3):
    from apps.bookings.models import AvailabilitySlot, VisitType

    slot, _ = AvailabilitySlot.objects.get_or_create(
        visit_type=VisitType.INDIVIDUAL,
        date=timezone.localdate() + dt.timedelta(days=days),
        start_time=dt.time(hour, 0),
        end_time=dt.time(hour + 1, 0),
        defaults={"capacity": capacity},
    )
    return slot


def make_booking(lead=None, **kw):
    from apps.bookings.models import Booking

    slot = kw.pop("slot", None) or make_slot()
    data = dict(
        slot=slot,
        parent_name="Marta Ejemplo",
        parent_email="marta@ejemplo.test",
        parent_phone="5512345678",
        child_name="Lucía",
        status=Booking.Status.CONFIRMED,
        pre_registration=lead,
    )
    data.update(kw)
    return Booking.objects.create(**data)


def deliver_documents(reg) -> list:
    """Mark every upload document of the registration's level «Entregado en físico»
    (Fase 4 checklist), so its documents gate is complete. The ficha item is
    satisfied by a sent ficha."""
    from .document_models import RegistrationDocumentState, RequiredDocument
    from .required_docs import documents_for_level, registration_level

    out = []
    for rd in documents_for_level(registration_level(reg)):
        if rd.kind == RequiredDocument.Kind.FICHA:
            continue
        out.append(
            RegistrationDocumentState.objects.update_or_create(
                registration=reg,
                required_document=rd,
                defaults={"state": RegistrationDocumentState.State.ENTREGADO_FISICO},
            )[0]
        )
    return out
