"""
Login brute-force lockout (django-axes, IK-SEC C2/C6).

The suite runs with AXES_ENABLED=False (conftest); these tests re-enable it
to pin the lockout contract on the JWT email/password endpoint: five failed
attempts lock the username+IP pair — after that even the CORRECT password is
rejected until the cooloff (or an explicit reset).
"""
import pytest
from django.urls import reverse

from axes.utils import reset as axes_reset

pytestmark = pytest.mark.django_db

TOKEN_URL = reverse('token-obtain')


@pytest.fixture(autouse=True)
def _axes_enabled(settings):
    """Re-enable axes for this module (the global conftest disables it)."""
    settings.AXES_ENABLED = True
    axes_reset()
    yield
    axes_reset()


class TestLoginLockout:
    def test_lockout_after_failure_limit(self, api_client, parent_user):
        for _ in range(5):
            resp = api_client.post(TOKEN_URL, {
                'email': parent_user.email, 'password': 'wrong-password',
            })
            assert resp.status_code in (400, 401, 429)

        # Locked: the CORRECT password must now be rejected too.
        locked = api_client.post(TOKEN_URL, {
            'email': parent_user.email, 'password': 'parent-pass-123',
        })
        assert locked.status_code in (401, 403, 429)
        assert 'access' not in (locked.json() or {})

    def test_reset_unlocks(self, api_client, parent_user):
        for _ in range(5):
            api_client.post(TOKEN_URL, {
                'email': parent_user.email, 'password': 'wrong-password',
            })
        axes_reset(username=parent_user.email)

        ok = api_client.post(TOKEN_URL, {
            'email': parent_user.email, 'password': 'parent-pass-123',
        })
        assert ok.status_code == 200
        assert 'access' in ok.json()

    def test_under_the_limit_login_still_works(self, api_client, parent_user):
        for _ in range(3):
            api_client.post(TOKEN_URL, {
                'email': parent_user.email, 'password': 'wrong-password',
            })
        ok = api_client.post(TOKEN_URL, {
            'email': parent_user.email, 'password': 'parent-pass-123',
        })
        assert ok.status_code == 200

    def test_other_user_not_locked_by_attacked_account(self, api_client,
                                                       parent_user, admin_user):
        for _ in range(5):
            api_client.post(TOKEN_URL, {
                'email': parent_user.email, 'password': 'wrong-password',
            })
        ok = api_client.post(TOKEN_URL, {
            'email': admin_user.email, 'password': 'admin-pass-123',
        })
        assert ok.status_code == 200
