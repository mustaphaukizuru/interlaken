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
    @pytest.mark.parametrize("n_children", [2, 6])
    def test_constant_queries_regardless_of_family_size(
        self, api_client, django_assert_num_queries, n_children
    ):
        parent = ParentFactory()
        for _ in range(n_children):
            StudentProfileFactory(parents=[parent])
        Payment.objects.create(
            user=parent,
            payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("80.00"),
            status=Payment.Status.SUCCESS,
        )
        for i in range(3):
            Announcement.objects.create(title=f"Aviso {i}", body="b")
        Notification.objects.create(user=parent, title="n", message="m")

        api_client.force_authenticate(parent)
        with django_assert_num_queries(DASHBOARD_BUDGET):
            resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == n_children
        assert len(resp.data["announcements"]) == 3


class TestAdminAnnouncementsBudget:
    @pytest.mark.parametrize("n_rows", [4, 12])
    def test_constant_queries_regardless_of_row_count(
        self, api_client, django_assert_num_queries, n_rows
    ):
        admin = AdminFactory()
        readers = [ParentFactory() for _ in range(2)]
        for i in range(n_rows):
            a = Announcement.objects.create(title=f"Comunicado {i}", body="b", created_by=admin)
            for reader in readers:
                AnnouncementRead.objects.create(announcement=a, user=reader)

        api_client.force_authenticate(admin)
        with django_assert_num_queries(ADMIN_ANNOUNCEMENTS_BUDGET):
            resp = api_client.get(reverse("admin-announcements"))
        assert resp.status_code == 200
        assert resp.data["count"] == n_rows
        assert all(row["read_count"] == 2 for row in resp.data["results"])


# ── Data Ops Phase 10: comunicados exports, delivery report, family lists ──
# Exports are consumed inside the assert block so the streamed rows and the
# audit insert are counted.
# count + annotated rows + audit insert.
ANNOUNCEMENTS_EXPORT_BUDGET = 3
# announcement + (email, push) status counts + failed rows + recipients
# + pending + read + acknowledged counts: fixed, whatever the audience size.
DELIVERY_BUDGET = 8
# announcement + count + rows (user joined, ack subquery) + audit insert.
DELIVERY_EXPORT_BUDGET = 4
# family comunicados: count + annotated page.
FAMILY_ANNOUNCEMENTS_BUDGET = 2
# family notifications: count + page.
FAMILY_NOTIFICATIONS_BUDGET = 2


def _csv_lines(resp) -> list[str]:
    raw = b"".join(resp.streaming_content) if resp.streaming else resp.content
    return [line for line in raw.decode("utf-8-sig").split("\r\n")[1:] if line]


def _fanned_out(n):
    """One comunicado delivered to ``n`` parents (half read, a third failed email)."""
    a = Announcement.objects.create(title="Aviso", body="b", requires_ack=True)
    for i in range(n):
        parent = ParentFactory()
        Notification.objects.create(
            user=parent,
            title="Aviso",
            message="b",
            announcement=a,
            is_read=bool(i % 2),
            email_status=(
                Notification.Delivery.FAILED if i % 3 == 0 else Notification.Delivery.SENT
            ),
        )
        AnnouncementRead.objects.create(announcement=a, user=parent)
    return a


class TestAnnouncementPhase10Budgets:
    @pytest.mark.parametrize("n", [1, 12])
    def test_admin_export(self, api_client, django_assert_num_queries, n):
        admin = AdminFactory()
        readers = [ParentFactory() for _ in range(2)]
        for i in range(n):
            a = Announcement.objects.create(title=f"C{i}", body="b", created_by=admin)
            for reader in readers:
                AnnouncementRead.objects.create(announcement=a, user=reader)
        api_client.force_authenticate(admin)
        with django_assert_num_queries(ANNOUNCEMENTS_EXPORT_BUDGET):
            resp = api_client.get(reverse("admin-announcements-export"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_delivery_report(self, api_client, django_assert_num_queries, n):
        a = _fanned_out(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(DELIVERY_BUDGET):
            resp = api_client.get(reverse("admin-announcement-delivery", args=[a.pk]))
        assert resp.status_code == 200
        assert resp.data["recipients"] == n
        assert len(resp.data["failed"]) == len(range(0, n, 3))

    @pytest.mark.parametrize("n", [1, 12])
    def test_delivery_export(self, api_client, django_assert_num_queries, n):
        a = _fanned_out(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(DELIVERY_EXPORT_BUDGET):
            resp = api_client.get(reverse("admin-announcement-delivery-export", args=[a.pk]))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_family_announcements(self, api_client, django_assert_num_queries, n):
        parent = ParentFactory()
        StudentProfileFactory(parents=[parent])
        for i in range(n):
            a = Announcement.objects.create(title=f"A{i}", body="b")
            AnnouncementRead.objects.create(announcement=a, user=parent)
        api_client.force_authenticate(parent)
        with django_assert_num_queries(FAMILY_ANNOUNCEMENTS_BUDGET):
            resp = api_client.get(reverse("announcements"))
        assert resp.status_code == 200
        assert resp.data["count"] == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_family_notifications(self, api_client, django_assert_num_queries, n):
        parent = ParentFactory()
        for i in range(n):
            Notification.objects.create(user=parent, title=f"n{i}", message="m")
        api_client.force_authenticate(parent)
        with django_assert_num_queries(FAMILY_NOTIFICATIONS_BUDGET):
            resp = api_client.get(reverse("notifications"))
        assert resp.status_code == 200
        assert resp.data["count"] == n
