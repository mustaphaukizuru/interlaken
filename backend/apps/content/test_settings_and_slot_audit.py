"""QA sweep 2026-11-24 (round 2): saving the site settings (menu, header
buttons, school year...) and creating, editing or deleting visit slots leave
an audit row naming what changed."""
from datetime import time, timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.bookings.models import AvailabilitySlot, VisitType
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


def _rows(object_type, context):
    return list(AuditLog.objects.filter(object_type=object_type, context=context))


class TestSiteSettingsAudit:
    def test_menu_chrome_and_year_are_audited_once(self, admin_client):
        menu = [{'label': 'El Colegio', 'items': [{'label': 'Nosotros', 'to': '/nosotros'}]}]
        resp = admin_client.patch(reverse('admin-site-settings'),
                                  {'menu': menu, 'school_year': '2027-2028',
                                   'chrome': {'footer_note': 'Validez oficial SEP'}}, format='json')
        assert resp.status_code == 200, resp.data
        [row] = _rows('content.sitesettings', 'cms: ajustes del sitio')
        assert row.action == 'update'
        assert row.changes['menu'] == '(modificado)'
        assert row.changes['chrome'] == '(modificado)'
        assert row.changes['school_year'][1] == '2027-2028'
        assert row.actor is not None

    def test_phone_and_whatsapp_keep_their_single_signal_row(self, admin_client):
        admin_client.patch(reverse('admin-site-settings'),
                           {'phone_display': '55 1111 2222', 'whatsapp_number': '5215511112222'},
                           format='json')
        assert not _rows('content.sitesettings', 'cms: ajustes del sitio')
        signal = AuditLog.objects.filter(object_type='content.sitesettings', action='update',
                                         context='content.settings').get()
        assert signal.changes['whatsapp_number'][1] == '5215511112222'

    def test_unchanged_save_writes_nothing(self, admin_client):
        current = admin_client.get(reverse('admin-site-settings')).data
        admin_client.patch(reverse('admin-site-settings'), {'school_year': current['school_year']},
                           format='json')
        assert not _rows('content.sitesettings', 'cms: ajustes del sitio')


class TestSlotAudit:
    def test_generator_writes_one_summary_row(self, admin_client):
        start = timezone.localdate() + timedelta(days=7)
        js_day = (start.weekday() + 1) % 7
        resp = admin_client.post(reverse('bookings-availability'), {
            'visit_type': 'individual', 'start_date': start.isoformat(),
            'end_date': start.isoformat(), 'weekdays': [js_day], 'window_start': '09:00',
            'window_end': '10:00', 'interval_minutes': 30, 'capacity': 2,
        }, format='json')
        assert resp.status_code == 201 and resp.data['created'] == 2
        [row] = _rows('bookings.availabilityslot', 'bookings: generar horarios')
        assert row.action == 'create' and row.object_id == 'generador'
        assert row.changes['created'] == 2 and row.changes['window'] == '09:00-10:00'

    def test_edit_and_delete_are_audited(self, admin_client):
        slot = AvailabilitySlot.objects.create(
            visit_type=VisitType.INDIVIDUAL, date=timezone.localdate() + timedelta(days=3),
            start_time=time(9, 0), end_time=time(9, 30), capacity=2, location='Campus')
        url = reverse('bookings-admin-slot-detail', args=[slot.pk])
        assert admin_client.patch(url, {'capacity': 4, 'location': 'Biblioteca'},
                                  format='json').status_code == 200
        [upd] = _rows('bookings.availabilityslot', 'bookings: horario')
        assert upd.action == 'update' and upd.object_id == str(slot.pk)
        assert upd.changes == {'capacity': [2, 4], 'location': ['Campus', 'Biblioteca']}
        assert admin_client.delete(url).status_code == 204
        dele = AuditLog.objects.get(object_type='bookings.availabilityslot', action='delete')
        assert dele.object_id == str(slot.pk)
