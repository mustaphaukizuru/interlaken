"""Bitácora 14/10/2026, punto 10: families cannot edit their own profile; staff can."""
import io

import pytest
from django.urls import reverse
from PIL import Image

from apps.accounts.factories import AdminFactory, ParentFactory, StudentUserFactory

pytestmark = pytest.mark.django_db


def _png():
    buf = io.BytesIO()
    Image.new('RGB', (8, 8), 'white').save(buf, format='PNG')
    buf.seek(0)
    buf.name = 'a.png'
    return buf


@pytest.mark.parametrize('factory', [ParentFactory, StudentUserFactory])
def test_family_cannot_patch_profile(api_client, factory):
    user = factory(first_name='Ana', whatsapp='')
    api_client.force_authenticate(user)
    r = api_client.patch(reverse('current-user'), {'first_name': 'Otra', 'whatsapp': '5512345678'}, format='json')
    assert r.status_code == 403 and r.data['code'] == 'profile_locked'
    user.refresh_from_db()
    assert user.first_name == 'Ana' and user.whatsapp == ''
    assert api_client.get(reverse('current-user')).status_code == 200  # reading still works


@pytest.mark.parametrize('factory', [ParentFactory, StudentUserFactory])
def test_family_cannot_change_or_remove_photo(api_client, factory):
    api_client.force_authenticate(factory())
    assert api_client.post('/api/v1/accounts/me/avatar/', {'file': _png()}, format='multipart').status_code == 403
    assert api_client.delete('/api/v1/accounts/me/avatar/').status_code == 403


def test_staff_can_still_edit_their_profile(api_client):
    admin = AdminFactory(first_name='Lupe')
    api_client.force_authenticate(admin)
    r = api_client.patch(reverse('current-user'), {'first_name': 'Guadalupe'}, format='json')
    assert r.status_code == 200
    admin.refresh_from_db()
    assert admin.first_name == 'Guadalupe'


def test_there_is_no_self_service_password_change(api_client):
    api_client.force_authenticate(ParentFactory())
    r = api_client.patch(reverse('current-user'), {'password': 'nueva-clave-123'}, format='json')
    assert r.status_code == 403


def test_own_whatsapp_follows_the_phone_rule(api_client):
    # QA 2026-11-24: the WhatsApp field accepted letters; a number saved before
    # the rule is sent back unchanged with the name and still saves.
    admin = AdminFactory(first_name='Lupe', whatsapp='55 ext 1')
    api_client.force_authenticate(admin)
    url = reverse('current-user')
    r = api_client.patch(url, {'first_name': 'Guadalupe', 'whatsapp': '55 ext 1'}, format='json')
    assert r.status_code == 200, r.data
    r = api_client.patch(url, {'whatsapp': '55 1234 abcd'}, format='json')
    assert r.status_code == 400 and r.data['whatsapp'] == [
        'Escriba solo números; puede usar espacios, guiones, paréntesis y el signo +.']
    r = api_client.patch(url, {'whatsapp': '5512'}, format='json')
    assert r.status_code == 400 and r.data['whatsapp'] == ['El número debe tener de 10 a 15 dígitos.']
    r = api_client.patch(url, {'whatsapp': ' +52 1 55 1234 5678 '}, format='json')
    assert r.status_code == 200, r.data
    admin.refresh_from_db()
    assert admin.whatsapp == '+52 1 55 1234 5678'
