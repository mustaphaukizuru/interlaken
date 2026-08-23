import pytest
from django.urls import reverse

from apps.accounts.factories import StudentProfileFactory


@pytest.mark.django_db
def test_filters_and_ordering(admin_client):
    a = StudentProfileFactory(grade='1° Primaria', group='A')
    b = StudentProfileFactory(grade='3° Secundaria', group='B')
    c = StudentProfileFactory(grade='2° Preescolar', group='A')
    url = reverse('students')
    ids = lambda r: [x['id'] for x in r.data['results']]  # noqa: E731
    assert ids(admin_client.get(url, {'nivel': 'primaria'})) == [a.id]
    assert set(ids(admin_client.get(url, {'grupo': 'a'}))) == {a.id, c.id}
    assert ids(admin_client.get(url, {'grado': '3° Secundaria'})) == [b.id]
    by_grade = ids(admin_client.get(url, {'ordering': 'grade'}))
    assert by_grade == [a.id, c.id, b.id]
    assert ids(admin_client.get(url, {'ordering': '-grade'})) == [b.id, c.id, a.id]
    assert len(ids(admin_client.get(url, {'ordering': 'evil'}))) == 3


@pytest.mark.django_db
def test_bulk_status_and_group(admin_client, parent_user):
    from rest_framework.test import APIClient
    auth_client = APIClient()
    auth_client.force_authenticate(parent_user)
    a, b = StudentProfileFactory(group='A'), StudentProfileFactory(group='A')
    url = reverse('admin-student-bulk')
    assert auth_client.post(url, {'ids': [a.id], 'action': 'group', 'value': 'B'}, format='json').status_code == 403
    assert admin_client.post(url, {'ids': [], 'action': 'group', 'value': 'B'}, format='json').status_code == 400
    assert admin_client.post(url, {'ids': [a.id], 'action': 'status', 'value': 'nope'}, format='json').status_code == 400
    r = admin_client.post(url, {'ids': [a.id, b.id], 'action': 'group', 'value': 'B'}, format='json')
    assert r.status_code == 200 and r.data['updated'] == 2
    r = admin_client.post(url, {'ids': [a.id, b.id], 'action': 'status', 'value': 'on_leave'}, format='json')
    assert r.data['updated'] == 2
    a.refresh_from_db()
    assert a.group == 'B' and a.status == 'on_leave' and a.is_active is False
    assert admin_client.post(url, {'ids': [a.id], 'action': 'status', 'value': 'on_leave'}, format='json').data['updated'] == 0
