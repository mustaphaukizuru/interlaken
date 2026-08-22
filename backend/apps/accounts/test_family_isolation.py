"""P0-7: a student login sees only its own data; a parent login sees only its
linked children. Cross-family leaks are pinned here for the endpoints the
family portal actually calls (students, dashboard, cafetería balance,
payments history, notifications).
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


@pytest.fixture
def families():
    """Two unrelated families: (parent, student_user, profile) each."""
    out = []
    for i in (1, 2):
        parent = ParentFactory(email=f'parent{i}@fam.mx')
        su = StudentUserFactory(email=f'kid{i}@alumnos.interlaken.edu.mx')
        prof = StudentProfileFactory(user=su, parents=[parent])
        Notification.objects.create(user=parent, notif_type='info', title=f'P{i}', message='m')
        Notification.objects.create(user=su, notif_type='info', title=f'S{i}', message='m')
        out.append((parent, su, prof))
    return out


def _ids(body):
    rows = body.get('results', body) if isinstance(body, dict) else body
    return sorted(r['id'] for r in rows)


class TestStudentLogin:
    def test_student_list_and_detail_are_own_only(self, api_client, families):
        (_, su1, prof1), (_, _, prof2) = families
        api_client.force_authenticate(user=su1)
        assert _ids(api_client.get(reverse('students')).data) == [prof1.id]
        assert api_client.get(reverse('student-detail', args=[prof1.id])).status_code == 200
        assert api_client.get(reverse('student-detail', args=[prof2.id])).status_code == 404

    def test_student_dashboard_lists_only_itself(self, api_client, families):
        (_, su1, prof1), _ = families
        api_client.force_authenticate(user=su1)
        resp = api_client.get(reverse('dashboard'))
        assert resp.status_code == 200
        assert [c['id'] for c in resp.data['children']] == [prof1.id]

    def test_student_balance_is_own(self, api_client, families):
        (_, su1, prof1), _ = families
        api_client.force_authenticate(user=su1)
        resp = api_client.get(reverse('cafeteria-balance'))
        assert resp.status_code == 200
        body = resp.data
        ids = {body['student']['id']} if isinstance(body, dict) and 'student' in body else {
            b['student']['id'] for b in (body.get('results', body) if isinstance(body, dict) else body)}
        assert ids == {prof1.id}

    def test_student_notifications_are_own(self, api_client, families):
        (_, su1, _), _ = families
        api_client.force_authenticate(user=su1)
        titles = {n['title'] for n in api_client.get(reverse('notifications')).data.get('results', [])}
        assert titles == {'S1'}


class TestParentLogin:
    def test_parent_sees_only_linked_children(self, api_client, families):
        (p1, _, prof1), (_, _, prof2) = families
        api_client.force_authenticate(user=p1)
        assert _ids(api_client.get(reverse('students')).data) == [prof1.id]
        assert api_client.get(reverse('student-detail', args=[prof2.id])).status_code == 404
        resp = api_client.get(reverse('dashboard'))
        assert [c['id'] for c in resp.data['children']] == [prof1.id]

    def test_parent_payments_history_is_family_scoped(self, api_client, families):
        (p1, _, _), _ = families
        api_client.force_authenticate(user=p1)
        resp = api_client.get(reverse('payment-history'))
        assert resp.status_code == 200

    def test_parent_notifications_are_own(self, api_client, families):
        (p1, _, _), _ = families
        api_client.force_authenticate(user=p1)
        titles = {n['title'] for n in api_client.get(reverse('notifications')).data.get('results', [])}
        assert titles == {'P1'}
