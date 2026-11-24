"""QA sweep 2026-11-24 (round 2): a visit cancelled from the console emails
the family (with the calendar cancellation of the invite they got), and
attendance cannot be recorded before the visit starts."""
from datetime import time, timedelta

import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone

from apps.core.models import AuditLog

from .models import AvailabilitySlot, Booking, VisitType
from .services.ics import build_ics

pytestmark = pytest.mark.django_db

S = Booking.Status


@pytest.fixture(autouse=True)
def _locmem(settings):
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'


def _slot(days=3, hour=9):
    return AvailabilitySlot.objects.create(
        visit_type=VisitType.INDIVIDUAL, date=timezone.localdate() + timedelta(days=days),
        start_time=time(hour, 0), end_time=time(hour, 30), capacity=5)


def _booking(slot, status=S.CONFIRMED, **kw):
    kw.setdefault('parent_email', 'ana@test.mx')
    return Booking.objects.create(slot=slot, parent_name='Ana López', parent_phone='5512345678',
                                  status=status, **kw)


def _act(client, booking, action, **body):
    return client.post(reverse('bookings-admin-action', args=[booking.pk, action]), body,
                       format='json')


def _bulk(client, action, ids, **payload):
    return client.post(reverse('bookings-admin-bulk'),
                       {'action': action, 'ids': ids, 'payload': payload}, format='json')


class TestCancellationEmail:
    def test_console_cancel_emails_the_family_with_an_ics_cancel(self, admin_client):
        b = _booking(_slot(), confirmation_sent=True)
        resp = _act(admin_client, b, 'cancel')
        assert resp.status_code == 200 and resp.data['status'] == 'cancelled'
        assert len(mail.outbox) == 1
        msg = mail.outbox[0]
        assert msg.to == ['ana@test.mx']
        assert msg.subject == 'Su visita al Colegio Interlaken fue cancelada'
        assert 'quedó cancelada' in msg.body and '—' not in msg.body
        [(name, ics, mimetype)] = msg.attachments
        assert name == 'visita-interlaken.ics' and 'method=CANCEL' in mimetype
        assert 'METHOD:CANCEL' in ics and 'STATUS:CANCELLED' in ics and 'SEQUENCE:1' in ics
        # Same event as the confirmation's invite, so the calendar removes it.
        uid = f'UID:booking-{b.pk}@interlaken.edu.mx'
        assert uid in ics and uid in build_ics(b)

    def test_no_ics_when_no_confirmation_went_out(self, admin_client):
        b = _booking(_slot(), status=S.PENDING, confirmation_sent=False)
        assert _act(admin_client, b, 'cancel').status_code == 200
        assert len(mail.outbox) == 1 and mail.outbox[0].attachments == []

    def test_notify_false_sends_nothing(self, admin_client):
        b = _booking(_slot(), confirmation_sent=True)
        assert _act(admin_client, b, 'cancel', notify=False).status_code == 200
        assert mail.outbox == []

    def test_bulk_cancel_emails_each_family_unless_notify_false(self, admin_client):
        slot = _slot()
        a = _booking(slot, parent_email='a@test.mx')
        b = _booking(slot, parent_email='b@test.mx')
        assert _bulk(admin_client, 'cancel', [a.pk]).data['ok'] == 1
        assert [m.to for m in mail.outbox] == [['a@test.mx']]
        assert _bulk(admin_client, 'cancel', [b.pk], notify=False).data['ok'] == 1
        assert len(mail.outbox) == 1

    def test_past_visit_is_not_emailed(self, admin_client):
        b = _booking(_slot(days=-1), status=S.PENDING)
        assert _act(admin_client, b, 'cancel').status_code == 200
        assert mail.outbox == []

    def test_confirmation_invite_title_has_no_dash(self):
        ics = build_ics(_booking(_slot()))
        assert 'SUMMARY:Visita al Colegio Interlaken (' in ics and '—' not in ics
        assert 'METHOD:PUBLISH' in ics and 'SEQUENCE:0' in ics


class TestAttendanceNotBeforeTheVisit:
    @pytest.mark.parametrize('action', ['attended', 'no_show'])
    def test_single_action_before_start_is_400(self, admin_client, action):
        b = _booking(_slot(days=2))
        resp = _act(admin_client, b, action)
        assert resp.status_code == 400
        assert 'La visita aún no ocurre.' in str(resp.data)
        b.refresh_from_db()
        assert b.status == S.CONFIRMED
        assert not AuditLog.objects.filter(object_type='bookings.booking').exists()

    def test_bulk_before_start_fails_those_rows_only(self, admin_client):
        future = _booking(_slot(days=2))
        past = _booking(_slot(days=-1))
        resp = _bulk(admin_client, 'attended', [future.pk, past.pk])
        assert resp.data['ok'] == 1
        assert [f['id'] for f in resp.data['failed']] == [future.pk]
        assert 'aún no ocurre' in resp.data['failed'][0]['error']
        dry = admin_client.post(reverse('bookings-admin-bulk'),
                                {'action': 'no_show', 'ids': [future.pk], 'dry_run': True},
                                format='json')
        assert dry.data['ok'] == 0 and [f['id'] for f in dry.data['failed']] == [future.pk]

    def test_outcome_before_the_visit_is_400(self, admin_client):
        b = _booking(_slot(days=2))
        resp = admin_client.post(reverse('bookings-admin-outcome', args=[b.pk]),
                                 {'outcome': 'interested'}, format='json')
        assert resp.status_code == 400
        b.refresh_from_db()
        assert b.status == S.CONFIRMED and b.outcome == ''

    def test_after_start_still_works(self, admin_client):
        now = timezone.localtime()
        b = _booking(_slot(days=0, hour=max(now.hour - 1, 0)) if now.hour >= 1 else _slot(days=-1))
        assert _act(admin_client, b, 'attended').data['status'] == 'attended'


class TestUndoAttendance:
    def test_attended_back_to_confirmed_needs_a_note(self, admin_client):
        # A visit marked «Asistió» before it happened (before the guard) can
        # go back to «Confirmada», then be cancelled or rescheduled.
        b = _booking(_slot(days=2), status=S.ATTENDED, confirmation_sent=True)
        assert _act(admin_client, b, 'confirm').status_code == 400
        resp = _act(admin_client, b, 'confirm', note='Se marcó por error antes de la visita')
        assert resp.status_code == 200 and resp.data['status'] == 'confirmed'
        assert mail.outbox == []  # the confirmation had already gone out
        assert _act(admin_client, b, 'cancel').data['status'] == 'cancelled'

    def test_no_show_back_to_confirmed(self, admin_client):
        b = _booking(_slot(days=-1), status=S.NO_SHOW)
        resp = _act(admin_client, b, 'confirm', note='Error de captura', notify=False)
        assert resp.status_code == 200 and resp.data['status'] == 'confirmed'

    def test_not_once_a_result_is_recorded(self, admin_client):
        b = _booking(_slot(days=-1), status=S.ATTENDED, outcome=Booking.Outcome.ENROLLING)
        resp = _act(admin_client, b, 'confirm', note='x')
        assert resp.status_code == 400 and 'resultado' in str(resp.data)
