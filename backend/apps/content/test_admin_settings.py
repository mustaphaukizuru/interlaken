"""Admin CMS: edit the public site settings (contact/WhatsApp/socials) — admin-only."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.content.models import SiteSettings

pytestmark = pytest.mark.django_db
URL = reverse('admin-site-settings')


class TestAdminSiteSettings:
    def test_admin_reads_settings(self, api_client):
        api_client.force_authenticate(AdminFactory())
        resp = api_client.get(URL)
        assert resp.status_code == 200
        assert 'whatsapp_number' in resp.json()

    def test_admin_updates_settings(self, api_client):
        api_client.force_authenticate(AdminFactory())
        resp = api_client.patch(URL, {
            'whatsapp_number': '5215500000000',
            'contact_email': 'nuevo@interlaken.edu.mx',
        }, format='json')
        assert resp.status_code == 200, resp.content
        s = SiteSettings.load()
        assert s.whatsapp_number == '5215500000000'
        assert s.contact_email == 'nuevo@interlaken.edu.mx'

    def test_parent_forbidden(self, api_client):
        api_client.force_authenticate(ParentFactory())
        assert api_client.get(URL).status_code == 403
        assert api_client.patch(URL, {'whatsapp_number': 'x'}, format='json').status_code == 403
