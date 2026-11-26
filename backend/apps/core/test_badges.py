from datetime import time, timedelta

import pytest
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, UserFactory
from apps.accounts.models import PasswordRequest, User
from apps.core.badges import _compute_badges, failed_payments_count, loyverse_sync_alerts
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_badge_cache():
    cache.clear()
    yield
    cache.clear()


def staff(*areas):
    return UserFactory(role=User.Role.STAFF, staff_areas=list(areas))


def test_badges_admin_and_family(api_client):
    parent = ParentFactory()
    Notification.objects.create(user=parent, notif_type='info', title='t', message='m')
    api_client.force_authenticate(user=parent)
    data = api_client.get(reverse('core-badges')).data
    assert data == {'notificaciones': 1}

    admin = AdminFactory()
    PasswordRequest.objects.create(user=parent, requested_email=parent.email)
    api_client.force_authenticate(user=admin)
    data = api_client.get(reverse('core-badges')).data
    assert data['contrasenas'] == 1 and {'admisiones', 'visitas', 'cafeteria'} <= set(data)
    # How long the oldest request has waited, in minutes (just created: 0).
    assert data['contrasenas_edad'] == 0


# ── the dashboard's «Pendientes» counters (UX Phase 7) ───────────────────────

PENDIENTES_KEYS = {
    'preregistros', 'inscripciones', 'documentos', 'visitas_hoy', 'visitas_cerrar', 'cafeteria_verificar',
    'cafeteria_caja', 'cafeteria_aplicar', 'pagos_fallidos', 'saldo_bajo', 'loyverse_alertas',
    'sin_loyverse', 'contrasenas', 'mensajes', 'arco', 'arco_vencidas',
}


def test_admin_gets_every_pendientes_counter_and_keeps_the_sidebar_keys():
    data = _compute_badges(AdminFactory())
    assert PENDIENTES_KEYS <= set(data)
    # The sidebar keys stay exactly as they were.
    assert {'notificaciones', 'admisiones', 'visitas', 'cafeteria', 'cafeteria_verificar',
            'contrasenas', 'mensajes', 'formularios', 'arco'} <= set(data)
    # Empty queues: zero and no age.
    assert all(data[k] == 0 for k in PENDIENTES_KEYS)
    assert not [k for k in data if k.endswith('_edad')]


@pytest.mark.parametrize('areas, expected', [
    (('cafeteria',), {'cafeteria', 'cafeteria_verificar', 'cafeteria_caja', 'cafeteria_aplicar',
                      'pagos_fallidos', 'saldo_bajo', 'loyverse_alertas'}),
    (('admisiones',), {'admisiones', 'preregistros', 'inscripciones', 'documentos'}),
    (('visitas', 'mensajes'), {'visitas', 'visitas_hoy', 'visitas_cerrar', 'mensajes', 'formularios'}),
    (('alumnos',), {'sin_loyverse'}),
    (('accesos',), {'contrasenas'}),
    (('comunicados',), set()),
])
def test_staff_only_get_the_counters_of_their_areas(areas, expected):
    data = _compute_badges(staff(*areas))
    assert set(data) - {'notificaciones'} == expected
    # ARCO is admin-only whatever the areas.
    assert 'arco' not in data and 'arco_vencidas' not in data


def test_documents_count_only_pending_uploads_of_live_registrations():
    from apps.admissions.models import Registration, RegistrationDocument

    def reg(status):
        return Registration.objects.create(
            child_first_name='Beto', child_last_name='Prueba', child_dob='2018-01-01',
            level='primaria', grade_applying='2° Primaria', parent1_name='Tutora Prueba',
            parent1_email='tutora@ejemplo.test', parent1_phone='5511112222', status=status)

    def doc(registration, status):
        d = RegistrationDocument(registration=registration, doc_type='curp_doc', filename='x.pdf',
                                 status=status, uploaded_at=timezone.now() - timedelta(hours=2))
        d.file.save('x.pdf', ContentFile(b'x'), save=False)
        d.save()

    live = reg(Registration.Status.SUBMITTED)
    doc(live, RegistrationDocument.Review.PENDING)
    doc(live, RegistrationDocument.Review.REJECTED)
    doc(live, RegistrationDocument.Review.APPROVED)
    doc(reg(Registration.Status.DRAFT), RegistrationDocument.Review.PENDING)
    doc(reg(Registration.Status.REVIEWING), RegistrationDocument.Review.PENDING)

    data = _compute_badges(staff('admisiones'))
    assert data['documentos'] == 2
    assert 119 <= data['documentos_edad'] <= 121
    assert data['inscripciones'] == 1


def test_visits_today_skip_cancelled_and_other_days():
    from apps.bookings.models import AvailabilitySlot, Booking

    today = timezone.localdate()

    hours = iter(range(8, 18))

    def book(day, status):
        h = next(hours)
        slot = AvailabilitySlot.objects.create(date=day, start_time=time(h), end_time=time(h, 30), capacity=5)
        Booking.objects.create(slot=slot, parent_name='Tutora Prueba', parent_email='t@ejemplo.test',
                               parent_phone='5511112222', status=status)

    book(today, Booking.Status.CONFIRMED)
    book(today, Booking.Status.PENDING)
    book(today, Booking.Status.CANCELLED)
    book(today + timedelta(days=1), Booking.Status.CONFIRMED)
    data = _compute_badges(staff('visitas'))
    assert data['visitas_hoy'] == 2
    # The red dot counts the people coming (owner 2026-11-25): every standing
    # visit from today on, confirmed or pending, not only «Pendiente» ones.
    assert data['visitas'] == 3
    assert data['visitas_cerrar'] == 0


def test_visitas_red_dot_counts_upcoming_and_por_cerrar_counts_unclosed_past_visits():
    from apps.bookings.models import AvailabilitySlot, Booking

    today = timezone.localdate()
    hours = iter(range(8, 18))

    def book(day, status):
        h = next(hours)
        slot = AvailabilitySlot.objects.create(date=day, start_time=time(h), end_time=time(h, 30), capacity=5)
        Booking.objects.create(slot=slot, parent_name='Tutora Prueba', parent_email='t@ejemplo.test',
                               parent_phone='5511112222', status=status)

    # A web booking is confirmed on the spot: before 2026-11-26 none of these lit the dot.
    book(today + timedelta(days=1), Booking.Status.CONFIRMED)
    book(today + timedelta(days=2), Booking.Status.CONFIRMED)
    book(today + timedelta(days=3), Booking.Status.CANCELLED)
    # Past: still open (to close), and already closed one way or another.
    book(today - timedelta(days=2), Booking.Status.CONFIRMED)
    book(today - timedelta(days=1), Booking.Status.PENDING)
    book(today - timedelta(days=1), Booking.Status.ATTENDED)
    book(today - timedelta(days=1), Booking.Status.NO_SHOW)
    book(today - timedelta(days=1), Booking.Status.CANCELLED)

    data = _compute_badges(staff('visitas'))
    assert data['visitas'] == 2
    assert data['visitas_cerrar'] == 2
    # Only for accounts that may open Visitas.
    assert 'visitas_cerrar' not in _compute_badges(staff('cafeteria'))
    assert _compute_badges(AdminFactory())['visitas_cerrar'] == 2


def test_failed_payments_skip_family_cancellations_and_old_ones():
    from apps.payments.factories import PaymentFactory
    from apps.payments.models import Payment

    now = timezone.now()
    PaymentFactory(status=Payment.Status.FAILED)                                   # declined
    PaymentFactory(status=Payment.Status.FAILED, gateway_raw={'stage': 'bank_timeout'})
    PaymentFactory(status=Payment.Status.FAILED, gateway_raw={'stage': 'cancel'})   # family
    PaymentFactory(status=Payment.Status.FAILED, gateway_raw={'stage': 'expire'})   # family
    PaymentFactory(status=Payment.Status.FAILED, gateway_raw={'stage': 'supersede'})
    old = PaymentFactory(status=Payment.Status.FAILED)
    Payment.objects.filter(pk=old.pk).update(created_at=now - timedelta(days=9))
    stuck = PaymentFactory(status=Payment.Status.PROCESSING)  # not a FAILED row: the link can't list it
    Payment.objects.filter(pk=stuck.pk).update(created_at=now - timedelta(hours=30))
    PaymentFactory(status=Payment.Status.PENDING)  # still inside the bank window
    PaymentFactory(status=Payment.Status.SUCCESS)

    assert failed_payments_count() == 2
    assert _compute_badges(staff('cafeteria'))['pagos_fallidos'] == 2


def test_loyverse_alerts_count_the_stale_cron_checks():
    from apps.cafeteria.models import LoyverseSyncState

    with override_settings(LOYVERSE_API_TOKEN=''):
        assert loyverse_sync_alerts() == 0  # not configured: no false alarm
    with override_settings(LOYVERSE_API_TOKEN='tok'):
        assert loyverse_sync_alerts() == 2  # neither check has ever run
        now = timezone.now()
        state = LoyverseSyncState.load()
        state.last_poll_at = now - timedelta(minutes=5)
        state.last_roster_sync_at = now - timedelta(hours=40)
        state.save()
        assert loyverse_sync_alerts() == 1
        LoyverseSyncState.objects.filter(pk=state.pk).update(last_roster_sync_at=now - timedelta(hours=2))
        assert loyverse_sync_alerts() == 0


def test_arco_overdue_is_admin_only():
    from apps.legal.models import ArcoRequest

    requester = ParentFactory()
    late = ArcoRequest.objects.create(requester=requester, requester_email=requester.email,
                                      request_type='access')
    ArcoRequest.objects.filter(pk=late.pk).update(
        statutory_deadline=timezone.localdate() - timedelta(days=1))
    ArcoRequest.objects.create(requester=requester, requester_email=requester.email,
                               request_type='opposition')
    data = _compute_badges(AdminFactory())
    assert data['arco'] == 2 and data['arco_vencidas'] == 1
    secretaria = staff('alumnos', 'accesos', 'admisiones', 'visitas', 'mensajes', 'comunicados')
    assert 'arco_vencidas' not in _compute_badges(secretaria)


def test_an_empty_money_queue_has_no_age():
    data = _compute_badges(staff('cafeteria'))
    assert data['cafeteria_verificar'] == 0 and 'cafeteria_verificar_edad' not in data


def test_aplicar_counts_credited_topups_not_in_the_pos_and_never_doubles_verificar():
    """Code review 2026-11-22: a top-up waiting for its MultiCobros check is
    counted once (under «Por verificar»), and one already credited here but
    not loaded into Loyverse still shows under «Por aplicar»."""
    from decimal import Decimal

    from apps.accounts.factories import ParentFactory, StudentProfileFactory
    from apps.cafeteria.models import TopUpRequest
    from apps.payments.models import BanorteCheckout, Payment

    parent = ParentFactory()
    student = StudentProfileFactory(parents=[parent])

    def card_topup(status):
        topup = TopUpRequest.objects.create(
            student=student, amount=Decimal('100.00'), method=TopUpRequest.Method.ONLINE, status=status)
        payment = Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA, amount=Decimal('100.00'),
            gateway=Payment.Gateway.BANORTE, related_topup=topup, status=Payment.Status.SUCCESS)
        BanorteCheckout.objects.create(payment=payment, control_number=f'IK{payment.pk:06d}',
                                       mode='PRD', resultado_payw='A', referencia='123456')
        return topup

    card_topup(TopUpRequest.Status.PAID)        # approval not matched yet: «Por verificar» only
    card_topup(TopUpRequest.Status.COMPLETED)   # credited here, not in Loyverse yet: «Por aplicar»

    data = _compute_badges(staff('cafeteria'))
    assert data['cafeteria_verificar'] == 1
    assert data['cafeteria_aplicar'] == 1
