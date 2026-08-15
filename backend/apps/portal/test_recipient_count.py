"""
GET /api/v1/portal/admin/announcements/recipient-count/ — composer preview
(Admin console v2): counts the active accounts the fan-out would notify, using
the same role mapping as ``fanout_announcement``.
"""
import pytest
from django.urls import reverse

from apps.accounts.models import User

pytestmark = pytest.mark.django_db

URL_NAME = "admin-announcement-recipient-count"


def _mk(role, email):
    return User.objects.create_user(
        email=email, password="x", first_name="U", last_name="Ser", role=role)


class TestRecipientCount:
    def test_counts_match_fanout_roles(self, admin_client):
        _mk(User.Role.PARENT, "p1@test.mx")
        _mk(User.Role.PARENT, "p2@test.mx")
        _mk(User.Role.STUDENT, "s1@test.mx")
        _mk(User.Role.STAFF, "st1@test.mx")
        inactive = _mk(User.Role.PARENT, "off@test.mx")
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])

        # parents audience fans out to parent + student family logins.
        resp = admin_client.get(reverse(URL_NAME), {"audience": "parents"})
        assert resp.status_code == 200
        assert resp.data == {"audience": "parents", "count": 3}

        resp = admin_client.get(reverse(URL_NAME), {"audience": "staff"})
        assert resp.data["count"] == 1

        # all = parents + students + staff (admins are not notified).
        resp = admin_client.get(reverse(URL_NAME), {"audience": "all"})
        assert resp.data["count"] == 4

    def test_invalid_audience_is_400(self, admin_client):
        resp = admin_client.get(reverse(URL_NAME), {"audience": "aliens"})
        assert resp.status_code == 400

    def test_parent_is_403(self, api_client, parent_user):
        api_client.force_authenticate(user=parent_user)
        assert api_client.get(reverse(URL_NAME)).status_code == 403
