"""Portal dashboard family-login shape for school-email students."""

import pytest
from django.urls import reverse

from apps.accounts.factories import StudentProfileFactory

pytestmark = pytest.mark.django_db


class TestDashboardFamilyLogin:
    def test_student_without_self_guardian_gets_family_payload(self, api_client):
        """Missing parents M2M still yields children[] for ParentDashboard."""
        student = StudentProfileFactory()  # no parents.add(self)
        api_client.force_authenticate(user=student.user)

        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == 1
        assert resp.data["children"][0]["id"] == student.id
        assert resp.data["children"][0]["student_id"] == student.student_id
        assert "cafeteria_balances" in resp.data
        # Legacy thin student-only keys must not be the only shape.
        assert "cafeteria_balance" not in resp.data

    def test_self_guardian_student_gets_family_payload(self, api_client):
        student = StudentProfileFactory()
        student.parents.add(student.user)
        api_client.force_authenticate(user=student.user)

        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == 1
        assert resp.data["children"][0]["id"] == student.id
