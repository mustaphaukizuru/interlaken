"""Admin CRUD for tuition plans (FeeSchedule) — the console can now view/edit the
monthly amounts + late-fee policy that invoice generation reads (was admin-only)."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.finance.models import FeeSchedule

pytestmark = pytest.mark.django_db
URL = reverse('finance-admin-fees')


class TestFeeScheduleAdmin:
    def test_admin_creates_plan(self, api_client):
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(URL, {'name': 'Primaria', 'monthly_amount': '2500.00', 'due_day': 5}, format='json')
        assert resp.status_code == 201, resp.content
        f = FeeSchedule.objects.get()
        assert f.name == 'Primaria' and str(f.monthly_amount) == '2500.00'

    def test_admin_updates_and_toggles(self, api_client):
        f = FeeSchedule.objects.create(name='P', monthly_amount='1000', due_day=5)
        api_client.force_authenticate(AdminFactory())
        resp = api_client.patch(reverse('finance-admin-fee-detail', args=[f.id]),
                                {'monthly_amount': '1200', 'active': False}, format='json')
        assert resp.status_code == 200, resp.content
        f.refresh_from_db()
        assert str(f.monthly_amount) == '1200.00' and f.active is False

    def test_admin_deletes(self, api_client):
        f = FeeSchedule.objects.create(name='P', monthly_amount='1000', due_day=5)
        api_client.force_authenticate(AdminFactory())
        assert api_client.delete(reverse('finance-admin-fee-detail', args=[f.id])).status_code == 204
        assert not FeeSchedule.objects.filter(id=f.id).exists()

    def test_parent_forbidden(self, api_client):
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(URL).status_code == 403
        assert api_client.post(URL, {'name': 'x', 'monthly_amount': '1', 'due_day': 5}, format='json').status_code == 403
