import datetime as dt

import pytest
from django.core import mail
from django.urls import reverse

from apps.admissions.models import PreRegistration
from apps.bookings.models import AvailabilitySlot, Booking, VisitType
from apps.core.models import AuditLog


def _slot(days=3, hour=9, capacity=2):
    return AvailabilitySlot.objects.create(visit_type=VisitType.INDIVIDUAL, date=dt.date.today() + dt.timedelta(days=days),
                                           start_time=dt.time(hour, 0), end_time=dt.time(hour + 1, 0), capacity=capacity)


@pytest.fixture
def booking(db):
    return Booking.objects.create(slot=_slot(), parent_name='María', parent_email='maria@test.mx', parent_phone='5512345678',
                                  child_name='Ana', status=Booking.Status.CONFIRMED)


@pytest.mark.django_db
def test_reschedule_checks_capacity_and_emails(admin_client, booking, settings):
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    full = _slot(days=4, capacity=1)
    Booking.objects.create(slot=full, parent_name='X', parent_email='x@test.mx', parent_phone='55', status=Booking.Status.CONFIRMED)
    url = reverse('bookings-admin-reschedule', args=[booking.pk])
    assert admin_client.post(url, {'slot': full.pk}, format='json').status_code == 400
    assert admin_client.post(url, {'slot': booking.slot_id}, format='json').status_code == 400
    new = _slot(days=5, hour=11)
    r = admin_client.post(url, {'slot': new.pk}, format='json')
    assert r.status_code == 200 and r.data['slot'] == new.pk
    booking.refresh_from_db()
    assert booking.rescheduled_from_id is not None and booking.slot_id == new.pk
    assert 'reprogramada' in mail.outbox[-1].body and mail.outbox[-1].to == ['maria@test.mx']


@pytest.mark.django_db
def test_outcome_marks_attended_and_updates_prereg(admin_client, booking):
    pr = PreRegistration.objects.create(child_first_name='Ana', child_last_name='L', child_dob='2019-01-01', level='preescolar',
                                        grade_applying='K', parent_name='María', parent_email='MARIA@test.mx', parent_phone='55')
    url = reverse('bookings-admin-outcome', args=[booking.pk])
    assert admin_client.post(url, {'outcome': 'weird'}, format='json').status_code == 400
    r = admin_client.post(url, {'outcome': 'enrolling', 'note': 'Trae documentos el lunes'}, format='json')
    assert r.status_code == 200 and r.data['status'] == 'attended' and r.data['outcome'] == 'enrolling'
    assert r.data['pre_registration'] == {'id': pr.pk, 'status': 'enrolled', 'changed': True}
    pr.refresh_from_db()
    assert pr.status == 'enrolled'


@pytest.mark.django_db
def test_week_view_groups_slots_by_day(admin_client, booking):
    monday = booking.slot.date - dt.timedelta(days=booking.slot.date.weekday())
    r = admin_client.get(reverse('bookings-admin-week'), {'start': monday.isoformat()})
    assert r.status_code == 200 and len(r.data['days']) == 7 and r.data['start'] == monday.isoformat()
    day = next(d for d in r.data['days'] if d['date'] == booking.slot.date.isoformat())
    assert day['slots'][0]['booked'] == 1 and day['slots'][0]['bookings'][0]['parent_name'] == 'María'
    assert admin_client.get(reverse('bookings-admin-week'), {'start': 'nope'}).status_code == 400


def _prereg(**kw):
    data = dict(child_first_name='Ana', child_last_name='L', child_dob='2019-01-01', level='preescolar',
                grade_applying='K', parent_name='María', parent_email='maria@test.mx', parent_phone='55')
    data.update(kw)
    return PreRegistration.objects.create(**data)


@pytest.mark.django_db
def test_outcome_audits_prereg_and_respects_transition_table(admin_client, booking):
    pr = _prereg(status='rejected')
    r = admin_client.post(reverse('bookings-admin-outcome', args=[booking.pk]), {'outcome': 'interested'}, format='json')
    assert r.status_code == 200
    # rejected -> contacted is not in the table: skipped and reported, never forced
    assert r.data['pre_registration']['changed'] is False and 'skipped' in r.data['pre_registration']
    pr.refresh_from_db()
    assert pr.status == 'rejected'


@pytest.mark.django_db
def test_outcome_prereg_change_has_its_own_audit_row(admin_client, booking):
    pr = _prereg()
    r = admin_client.post(reverse('bookings-admin-outcome', args=[booking.pk]), {'outcome': 'interested'}, format='json')
    assert r.status_code == 200 and r.data['pre_registration']['status'] == 'contacted'
    assert AuditLog.objects.filter(object_type='admissions.preregistration', object_id=str(pr.pk)).exists()


@pytest.mark.django_db
@pytest.mark.parametrize('flag', ['false', False, '0'])
def test_outcome_update_prereg_false_is_respected(admin_client, booking, flag):
    pr = _prereg()
    r = admin_client.post(reverse('bookings-admin-outcome', args=[booking.pk]),
                          {'outcome': 'enrolling', 'update_prereg': flag}, format='json')
    assert r.status_code == 200 and r.data['pre_registration'] is None
    pr.refresh_from_db()
    assert pr.status == 'pending'


@pytest.mark.django_db
def test_outcome_refused_for_cancelled_or_no_show(admin_client, booking):
    for st in ('cancelled', 'no_show'):
        Booking.objects.filter(pk=booking.pk).update(status=st)
        r = admin_client.post(reverse('bookings-admin-outcome', args=[booking.pk]), {'outcome': 'declined'}, format='json')
        assert r.status_code == 400
    booking.refresh_from_db()
    assert booking.outcome == ''


@pytest.mark.django_db
def test_reschedule_guards(admin_client, booking):
    url = reverse('bookings-admin-reschedule', args=[booking.pk])
    assert admin_client.post(url, {'slot': 'abc'}, format='json').status_code == 400
    past = _slot(days=-1)
    r = admin_client.post(url, {'slot': past.pk}, format='json')
    assert r.status_code == 400 and 'pasó' in str(r.data)
    Booking.objects.filter(pk=booking.pk).update(status='attended')
    future = _slot(days=6)
    assert admin_client.post(url, {'slot': future.pk}, format='json').status_code == 400
    booking.refresh_from_db()
    assert booking.slot_id != future.pk
