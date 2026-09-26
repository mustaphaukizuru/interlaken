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
    """P1-A8 on the C5 contract: {action, ids, payload: {value}}."""
    from rest_framework.test import APIClient
    auth_client = APIClient()
    auth_client.force_authenticate(parent_user)
    a, b = StudentProfileFactory(group='A'), StudentProfileFactory(group='A')
    url = reverse('admin-student-bulk')

    def post(client, action, ids, value):
        return client.post(url, {'action': action, 'ids': ids, 'payload': {'value': value}},
                           format='json')

    assert post(auth_client, 'group', [a.id], 'B').status_code == 403
    assert post(admin_client, 'group', [], 'B').status_code == 400
    assert post(admin_client, 'status', [a.id], 'nope').status_code == 400
    r = post(admin_client, 'group', [a.id, b.id], 'b')
    assert r.status_code == 200 and r.data['ok'] == 2
    r = post(admin_client, 'status', [a.id, b.id], 'on_leave')
    assert r.data['ok'] == 2
    a.refresh_from_db()
    assert a.group == 'B' and a.status == 'on_leave' and a.is_active is False
    again = post(admin_client, 'status', [a.id], 'on_leave').data
    assert again['ok'] == 0 and len(again['skipped']) == 1
