"""
Announcement read receipts: idempotency, audience guarding, and the
circulars read_rate KPI they feed in the staff analytics payload.
"""
import pytest
from django.core.cache import cache
from django.urls import reverse

from apps.accounts.factories import UserFactory
from apps.accounts.models import User
from apps.portal.models import Announcement, AnnouncementRead

pytestmark = pytest.mark.django_db

MARK_URL = reverse('announcements-mark-read')
ANALYTICS_URL = reverse('staff-analytics')


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


def _announcement(audience=Announcement.Audience.ALL, **kwargs):
    return Announcement.objects.create(
        title='Circular', body='Contenido', audience=audience, **kwargs)


class TestMarkRead:
    def test_anonymous_401(self, api_client):
        assert api_client.post(MARK_URL, {'ids': [1]}, format='json').status_code == 401

    def test_invalid_payload_400(self, api_client, parent_user):
        api_client.force_authenticate(parent_user)
        assert api_client.post(MARK_URL, {'ids': 'x'}, format='json').status_code == 400
        assert api_client.post(MARK_URL, {}, format='json').status_code == 400

    def test_mark_is_idempotent(self, api_client, parent_user):
        ann = _announcement()
        api_client.force_authenticate(parent_user)
        first = api_client.post(MARK_URL, {'ids': [ann.id]}, format='json')
        second = api_client.post(MARK_URL, {'ids': [ann.id]}, format='json')
        assert first.status_code == second.status_code == 200
        assert AnnouncementRead.objects.filter(
            announcement=ann, user=parent_user).count() == 1

    def test_audience_guard(self, api_client):
        """Staff can't record a read on a parents-only circular (wrong audience);
        a family (student-role) account CAN — parent/student are merged."""
        parents_only = _announcement(audience=Announcement.Audience.PARENTS)

        staff = UserFactory(role=User.Role.STAFF)
        api_client.force_authenticate(staff)
        resp = api_client.post(MARK_URL, {'ids': [parents_only.id]}, format='json')
        assert resp.status_code == 200
        assert resp.json()['marked'] == 0
        assert AnnouncementRead.objects.count() == 0

        # A family (student-role) account sees parent-targeted comunicados.
        student = UserFactory(role=User.Role.STUDENT)
        api_client.force_authenticate(student)
        assert api_client.post(
            MARK_URL, {'ids': [parents_only.id]}, format='json'
        ).json()['marked'] == 1

    def test_inactive_not_recorded(self, api_client, parent_user):
        inactive = _announcement(is_active=False)
        api_client.force_authenticate(parent_user)
        resp = api_client.post(MARK_URL, {'ids': [inactive.id]}, format='json')
        assert resp.json()['marked'] == 0


class TestReadRateKpi:
    def test_read_rate_math(self, api_client, admin_user):
        """1 of 2 active parents read a parents-only circular → rate 0.5."""
        ann = _announcement(audience=Announcement.Audience.PARENTS)
        reader = UserFactory(role=User.Role.PARENT)
        UserFactory(role=User.Role.PARENT)  # eligible, never reads
        AnnouncementRead.objects.create(announcement=ann, user=reader)

        api_client.force_authenticate(admin_user)
        data = api_client.get(ANALYTICS_URL).json()
        assert data['circulars']['active'] == 1
        assert data['circulars']['read_rate'] == pytest.approx(0.5)

    def test_read_rate_null_without_active_announcements(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        data = api_client.get(ANALYTICS_URL).json()
        assert data['circulars'] == {'active': 0, 'read_rate': None}
