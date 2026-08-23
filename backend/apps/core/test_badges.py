import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.accounts.models import PasswordRequest
from apps.portal.models import Notification

pytestmark = pytest.mark.django_db


def test_badges_admin_and_family(api_client):
    parent = ParentFactory()
    Notification.objects.create(user=parent, notif_type='info', title='t', message='m')
    api_client.force_authenticate(user=parent)
    data = api_client.get(reverse('core-badges')).data
    assert data == {'notificaciones': 1}

    admin = AdminFactory()
    PasswordRequest.objects.create(user=parent, requested_email=parent.email)
    api_client.force_authenticate(user=admin)
    data = api_client.get(reverse('core-badges')).data
    assert data['contrasenas'] == 1 and {'admisiones', 'visitas', 'cafeteria'} <= set(data)
