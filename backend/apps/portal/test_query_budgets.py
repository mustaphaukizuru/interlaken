"""P7 query budgets: dashboard and admin comunicados stay O(1) in row count.

Each test parametrizes small-N vs 3N and asserts the SAME pinned constant, so
any reintroduced per-row query (N+1) fails the budget instead of slipping by.
"""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.payments.models import Payment
from apps.portal.models import Announcement, AnnouncementRead, Notification

pytestmark = pytest.mark.django_db

# students + balances + recent payments + announcements
# + unread-notifications count.
DASHBOARD_BUDGET = 5
# pagination count + annotated page rows (created_by joined, read_count_ann).
ADMIN_ANNOUNCEMENTS_BUDGET = 2


class TestDashboardBudget:
    @pytest.mark.parametrize('n_children', [2, 6])
    def test_constant_queries_regardless_of_family_size(
            self, api_client, django_assert_num_queries, n_children):
        parent = ParentFactory()
        for _ in range(n_children):
            StudentProfileFactory(parents=[parent])
        Payment.objects.create(
            user=parent, payment_type=Payment.Type.CAFETERIA,
            amount=Decimal('80.00'), status=Payment.Status.SUCCESS,
        )
        for i in range(3):
            Announcement.objects.create(title=f'Aviso {i}', body='b')
        Notification.objects.create(user=parent, title='n', message='m')

        api_client.force_authenticate(parent)
        with django_assert_num_queries(DASHBOARD_BUDGET):
            resp = api_client.get(reverse('dashboard'))
        assert resp.status_code == 200
        assert resp.data['children_count'] == n_children
        assert len(resp.data['announcements']) == 3


class TestAdminAnnouncementsBudget:
    @pytest.mark.parametrize('n_rows', [4, 12])
    def test_constant_queries_regardless_of_row_count(
            self, api_client, django_assert_num_queries, n_rows):
        admin = AdminFactory()
        readers = [ParentFactory() for _ in range(2)]
        for i in range(n_rows):
            a = Announcement.objects.create(
                title=f'Comunicado {i}', body='b', created_by=admin)
            for reader in readers:
                AnnouncementRead.objects.create(announcement=a, user=reader)

        api_client.force_authenticate(admin)
        with django_assert_num_queries(ADMIN_ANNOUNCEMENTS_BUDGET):
            resp = api_client.get(reverse('admin-announcements'))
        assert resp.status_code == 200
        assert resp.data['count'] == n_rows
        assert all(row['read_count'] == 2 for row in resp.data['results'])
