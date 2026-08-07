"""
finance.IsAdmin must reject anonymous callers with a clean 401 — never a 500
from reading ``.role`` on AnonymousUser (which is truthy but has no role).
"""
import pytest
from django.urls import reverse

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("url_name, method, kwargs", [
    ("finance-admin-dashboard", "get", {}),
    ("finance-admin-invoices", "get", {}),
    ("finance-admin-generate", "post", {}),
    ("finance-admin-student", "get", {"pk": 1}),
])
def test_anonymous_admin_endpoint_is_401_not_500(api_client, url_name, method, kwargs):
    url = reverse(url_name, kwargs=kwargs) if kwargs else reverse(url_name)
    resp = getattr(api_client, method)(url)
    assert resp.status_code == 401, resp.status_code
    assert resp.status_code != 500
