"""P2-16: calendario escolar, public read + admin CRUD."""
from datetime import date

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.content.models import SchoolEvent

pytestmark = pytest.mark.django_db


def test_public_calendar_filters_published_and_level(api_client):
    y = date.today().year
    SchoolEvent.objects.create(title='Vacaciones', kind='vacation', start_date=date(y, 12, 20), end_date=date(y + 1, 1, 6))
    SchoolEvent.objects.create(title='Junta primaria', kind='meeting', start_date=date(y, 10, 3), level='primaria')
    SchoolEvent.objects.create(title='Borrador', kind='event', start_date=date(y, 10, 4), is_published=False)
    resp = api_client.get(reverse('school-calendar'), {'from': f'{y}-09-01', 'to': f'{y + 1}-06-30'})
    assert resp.status_code == 200
    titles = [e['title'] for e in resp.data]
    assert 'Vacaciones' in titles and 'Junta primaria' in titles and 'Borrador' not in titles
    pre = api_client.get(reverse('school-calendar'), {'from': f'{y}-09-01', 'to': f'{y + 1}-06-30', 'level': 'preescolar'}).data
    assert 'Junta primaria' not in [e['title'] for e in pre]


def test_admin_crud_and_validation(api_client):
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.post(reverse('admin-calendar'), {}, format='json').status_code == 403
    api_client.force_authenticate(user=AdminFactory())
    bad = api_client.post(reverse('admin-calendar'), {'title': 'x', 'start_date': '2026-10-05', 'end_date': '2026-10-01'}, format='json')
    assert bad.status_code == 400 and 'end_date' in bad.data
    ok = api_client.post(reverse('admin-calendar'), {'title': 'Examen', 'kind': 'exam', 'start_date': '2026-10-05'}, format='json')
    assert ok.status_code == 201
    pk = ok.data['id']
    assert api_client.patch(reverse('admin-calendar-detail', args=[pk]), {'title': 'Examen final'}, format='json').data['title'] == 'Examen final'
    assert api_client.delete(reverse('admin-calendar-detail', args=[pk])).status_code == 204
