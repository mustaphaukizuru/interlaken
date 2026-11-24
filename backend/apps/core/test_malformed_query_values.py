"""QA sweep 2026-11-24: malformed query values answer 400, never 500."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory

pytestmark = pytest.mark.django_db


class TestCafeteriaStatementMonth:
    @pytest.mark.parametrize('month', ['9999-12', '0001-01', '2026-13', 'abc', '2026'])
    def test_bad_month_is_400(self, api_client, month):
        parent = ParentFactory()
        child = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(parent)
        resp = api_client.get(reverse('cafeteria-statement'), {'student': child.pk, 'month': month})
        assert resp.status_code == 400, (month, resp.status_code)
        assert 'month' in resp.data

    def test_a_real_month_still_renders(self, api_client):
        parent = ParentFactory()
        child = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(parent)
        resp = api_client.get(reverse('cafeteria-statement'), {'student': child.pk, 'month': '2026-11'})
        assert resp.status_code == 200
        assert resp['Content-Type'] == 'application/pdf'


class TestLegalConsentStudent:
    def test_non_numeric_student_is_400(self, api_client):
        api_client.force_authenticate(ParentFactory())
        resp = api_client.get(reverse('legal-consent'), {'student': 'abc'})
        assert resp.status_code == 400
        assert 'student' in resp.data

    def test_own_child_and_no_child_still_work(self, api_client):
        parent = ParentFactory()
        child = StudentProfileFactory(parents=[parent])
        api_client.force_authenticate(parent)
        assert api_client.get(reverse('legal-consent')).status_code == 200
        assert api_client.get(reverse('legal-consent'), {'student': child.pk}).status_code == 200
        other = StudentProfileFactory()
        assert api_client.get(reverse('legal-consent'), {'student': other.pk}).status_code == 404


class TestBookingsAdminWeek:
    @pytest.mark.parametrize('start', ['9999-12-31', '2026-02-30', 'abc'])
    def test_bad_start_is_400(self, api_client, start):
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(reverse('bookings-admin-week'), {'start': start})
        assert resp.status_code == 400, (start, resp.status_code)

    def test_a_real_week_still_works(self, api_client):
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(reverse('bookings-admin-week'), {'start': '2026-11-26'})
        assert resp.status_code == 200
        assert resp.data['start'] == '2026-11-23' and len(resp.data['days']) == 7
