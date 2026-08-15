"""P7 query budget: the admin student roster stays O(1) in student count.

Parametrizes small-N vs 3N (both within page 1) and asserts the SAME pinned
constant — the old per-student notif_prefs get_or_create N+1 fails this.
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, StudentProfileFactory

pytestmark = pytest.mark.django_db

# pagination count + page rows (user joined via select_related).
STUDENTS_BUDGET = 2


class TestStudentListBudget:
    @pytest.mark.parametrize('n_students', [6, 18])
    def test_constant_queries_regardless_of_roster_size(
            self, api_client, django_assert_num_queries, n_students):
        admin = AdminFactory()
        for _ in range(n_students):
            StudentProfileFactory()

        api_client.force_authenticate(admin)
        with django_assert_num_queries(STUDENTS_BUDGET):
            resp = api_client.get(reverse('students'))
        assert resp.status_code == 200
        assert resp.data['count'] == n_students
        # notif_prefs is /me-only; nested student users serve null (P7 P0-1).
        assert all(row['user']['notif_prefs'] is None for row in resp.data['results'])
