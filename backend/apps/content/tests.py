"""
Site settings endpoint (IK-CMS Phase 1): public read, singleton behavior,
cache + invalidation-on-save.
"""
import pytest
from django.core.cache import cache
from django.urls import reverse

from .models import SiteSettings

pytestmark = pytest.mark.django_db

URL = reverse('site-settings')


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


class TestPublicRead:
    def test_anonymous_can_read(self, api_client):
        resp = api_client.get(URL)
        assert resp.status_code == 200
        data = resp.json()
        assert set(data) == {
            'phone_display', 'phone_e164', 'whatsapp_number', 'contact_email',
            'address', 'maps_url', 'office_hours',
            'facebook_url', 'instagram_url', 'youtube_url', 'updated_at',
        }
        # Ships with the school's real number; socials start empty (icons hidden).
        assert data['phone_display'] == '(55) 5379-1188'
        assert data['facebook_url'] == ''

    def test_first_read_creates_the_singleton(self, api_client):
        assert SiteSettings.objects.count() == 0
        api_client.get(URL)
        assert SiteSettings.objects.count() == 1

    def test_second_read_is_cached(self, api_client, django_assert_num_queries):
        assert api_client.get(URL).status_code == 200
        with django_assert_num_queries(0):
            assert api_client.get(URL).status_code == 200


class TestSingleton:
    def test_load_is_idempotent(self):
        a = SiteSettings.load()
        b = SiteSettings.load()
        assert a.pk == b.pk == 1
        assert SiteSettings.objects.count() == 1

    def test_every_save_lands_on_pk_1(self):
        SiteSettings.load()
        rogue = SiteSettings(phone_display='555')
        rogue.save()
        assert SiteSettings.objects.count() == 1
        assert SiteSettings.objects.get().phone_display == '555'

    def test_save_invalidates_the_public_cache(self, api_client):
        assert api_client.get(URL).json()['phone_display'] == '(55) 5379-1188'
        obj = SiteSettings.load()
        obj.phone_display = '(55) 9999-0000'
        obj.save()
        assert api_client.get(URL).json()['phone_display'] == '(55) 9999-0000'
