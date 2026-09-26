"""P7 query budget: the admin student roster stays O(1) in student count.

Parametrizes small-N vs 3N (both within page 1) and asserts the SAME pinned
constant — the old per-student notif_prefs get_or_create N+1 fails this.

Data Ops Phase 10 adds the roster, staff and password-request exports and the
guardians sub-list; each export is consumed inside the assert block so the
streamed rows (and the audit insert) are counted.
"""

import pytest
from django.urls import reverse

from apps.accounts.factories import (
    AdminFactory,
    ParentFactory,
    StudentProfileFactory,
    UserFactory,
)
from apps.accounts.models import PasswordRequest

pytestmark = pytest.mark.django_db

# pagination count + page rows (user joined via select_related).
STUDENTS_BUDGET = 2
# count + rows (user joined, guardians subquery) + audit insert.
STUDENTS_EXPORT_BUDGET = 3
# count + rows + audit insert.
STAFF_EXPORT_BUDGET = 3
PASSWORD_REQUESTS_EXPORT_BUDGET = 3
# student (user joined) + guardians prefetch + parent profiles prefetch.
GUARDIANS_BUDGET = 3


def _body(resp) -> bytes:
    return b"".join(resp.streaming_content) if resp.streaming else resp.content


def _csv_lines(resp) -> list[str]:
    return [line for line in _body(resp).decode("utf-8-sig").split("\r\n")[1:] if line]


class TestStudentListBudget:
    @pytest.mark.parametrize("n_students", [6, 18])
    def test_constant_queries_regardless_of_roster_size(
        self, api_client, django_assert_num_queries, n_students
    ):
        admin = AdminFactory()
        for _ in range(n_students):
            StudentProfileFactory()

        api_client.force_authenticate(admin)
        with django_assert_num_queries(STUDENTS_BUDGET):
            resp = api_client.get(reverse("students"))
        assert resp.status_code == 200
        assert resp.data["count"] == n_students
        # notif_prefs is /me-only; nested student users serve null (P7 P0-1).
        assert all(row["user"]["notif_prefs"] is None for row in resp.data["results"])


class TestAccountsExportBudgets:
    @pytest.mark.parametrize("n", [1, 12])
    def test_students_export(self, api_client, django_assert_num_queries, n):
        api_client.force_authenticate(AdminFactory())
        parent = ParentFactory()
        for _ in range(n):
            StudentProfileFactory(parents=[parent])
        with django_assert_num_queries(STUDENTS_EXPORT_BUDGET):
            resp = api_client.get(reverse("export-students"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_staff_export(self, api_client, django_assert_num_queries, n):
        api_client.force_authenticate(AdminFactory())
        for i in range(n):
            UserFactory(role="staff", email=f"qb-staff{i}@x.mx")
        with django_assert_num_queries(STAFF_EXPORT_BUDGET):
            resp = api_client.get(reverse("admin-staff-export"))
            assert len(_csv_lines(resp)) == n + 1  # + the requesting admin

    @pytest.mark.parametrize("n", [1, 12])
    def test_password_requests_export(self, api_client, django_assert_num_queries, n):
        api_client.force_authenticate(AdminFactory())
        for i in range(n):
            PasswordRequest.objects.create(
                requested_email=f"qb{i}@x.mx", user=ParentFactory(), requester_name="R"
            )
        with django_assert_num_queries(PASSWORD_REQUESTS_EXPORT_BUDGET):
            resp = api_client.get(reverse("password-requests-export"))
            assert len(_csv_lines(resp)) == n


class TestGuardiansBudget:
    @pytest.mark.parametrize("n", [1, 8])
    def test_guardians_sub_list(self, api_client, django_assert_num_queries, n):
        api_client.force_authenticate(AdminFactory())
        parents = [ParentFactory() for _ in range(n)]
        student = StudentProfileFactory(parents=parents)
        with django_assert_num_queries(GUARDIANS_BUDGET):
            resp = api_client.get(reverse("student-guardians", args=[student.pk]))
        assert resp.status_code == 200
        assert resp.data["count"] == n
