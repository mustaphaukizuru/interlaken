"""P1-A9: an admin can fetch one student's credencial card; families cannot use ?student=."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory

pytestmark = pytest.mark.django_db


def test_admin_gets_one_students_card(api_client):
    a, b = StudentProfileFactory(), StudentProfileFactory()
    api_client.force_authenticate(user=AdminFactory())
    resp = api_client.get(reverse('cafeteria-cards'), {'student': b.pk})
    assert resp.status_code == 200
    assert [c['student']['id'] for c in resp.data] == [b.pk]
    assert resp.data[0]['code'] == b.student_id or resp.data[0]['code']
    assert a.pk not in [c['student']['id'] for c in resp.data]


def test_parent_cannot_peek_with_student_param(api_client):
    parent = ParentFactory()
    mine = StudentProfileFactory(parents=[parent])
    other = StudentProfileFactory()
    api_client.force_authenticate(user=parent)
    resp = api_client.get(reverse('cafeteria-cards'), {'student': other.pk})
    assert [c['student']['id'] for c in resp.data] == [mine.pk]


# A staff member's own cafetería account never reads «Alumno» (2026-11-19):
# the card carries tipo/puesto so the credential shows the puesto instead.
STAFF = {'tipo': 'personal', 'grade': '', 'group': ''}


@pytest.mark.parametrize('kw, expected', [
    ({}, ('alumno', '', '')),
    ({**STAFF, 'puesto': 'docente'}, ('personal', 'docente', 'Docente')),
    ({**STAFF, 'puesto': 'sin_asignar'}, ('personal', 'sin_asignar', 'Sin asignar')),
], ids=['alumno', 'personal-con-puesto', 'personal-sin-asignar'])
def test_card_says_whether_it_is_a_pupil_or_staff(api_client, kw, expected):
    parent = ParentFactory()
    account = StudentProfileFactory(parents=[parent], **kw)
    api_client.force_authenticate(user=parent)
    [card] = api_client.get(reverse('cafeteria-cards')).data
    student = card['student']
    assert student['id'] == account.pk
    assert (student['tipo'], student['puesto'], student['puesto_label']) == expected
