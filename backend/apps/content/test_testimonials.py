import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory
from apps.content.models import Testimonial

pytestmark = pytest.mark.django_db


def test_public_lists_only_published_and_admin_crud_busts_cache(api_client):
    Testimonial.objects.create(quote='Excelente', author='Ana', is_published=True)
    Testimonial.objects.create(quote='Borrador', author='B', is_published=False)
    assert [t['author'] for t in api_client.get(reverse('testimonials')).data] == ['Ana']
    api_client.force_authenticate(user=AdminFactory())
    resp = api_client.post(reverse('admin-testimonials'), {'quote': 'Nuevo', 'author': 'Luis', 'role': 'Papá'}, format='json')
    assert resp.status_code == 201
    authors = {t['author'] for t in api_client.get(reverse('testimonials')).data}
    assert authors == {'Ana', 'Luis'}
    assert api_client.delete(reverse('admin-testimonial-detail', args=[resp.data['id']])).status_code == 204
