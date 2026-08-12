"""
Custom permission classes (IsParentOrAdmin / IsAdmin) must reject anonymous
callers with a clean 401 — never a 500 from reading ``.role`` on AnonymousUser.
"""
import pytest
from django.urls import reverse

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("url_name, method, kwargs", [
    ("cafeteria-topup", "post", {}),          # IsParentOrAdmin
    ("cafeteria-export", "get", {}),          # IsParentOrAdmin
    ("admin-balances", "get", {}),            # IsAdmin
    ("admin-topups", "get", {}),              # IsAdmin
    ("admin-topup-pos-loaded", "post", {"pk": 1}),  # IsAdmin
    ("admin-topup-pos-unloaded", "post", {"pk": 1}),  # IsAdmin
    ("admin-sync-balance", "post", {"pk": 1}),  # IsAdmin
])
def test_anonymous_gets_401_not_500(api_client, url_name, method, kwargs):
    url = reverse(url_name, kwargs=kwargs) if kwargs else reverse(url_name)
    resp = getattr(api_client, method)(url)
    assert resp.status_code == 401, resp.status_code
    assert resp.status_code != 500
