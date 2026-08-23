import pytest
from django.core import mail
from django.urls import reverse

from apps.legal.models import ArcoRequest


@pytest.mark.django_db
def test_intake_status_and_notifications(admin_client, parent_user, settings):
    settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
    r = admin_client.post(reverse('legal-admin-arco-intake'), {
        'requester_email': parent_user.email.upper(), 'requester_name': 'Mamá López', 'request_type': 'rectification',
        'channel': 'email', 'details': 'Corregir teléfono',
    }, format='json')
    assert r.status_code == 201, r.data
    arco = ArcoRequest.objects.get()
    assert arco.requester_id == parent_user.pk and arco.channel == 'email' and arco.intake_by is not None
    assert r.data['days_left'] > 0 and r.data['is_overdue'] is False
    assert mail.outbox[-1].to == [parent_user.email] and 'plazo legal' in mail.outbox[-1].body
    assert mail.outbox[-1].reply_to == ['privacidad@interlaken.com.mx']

    listed = admin_client.get(reverse('legal-admin-arco') + '?status=received').data
    rows = listed['results'] if isinstance(listed, dict) else listed
    assert rows[0]['channel'] == 'email'

    r = admin_client.post(reverse('legal-admin-arco-status', args=[arco.pk]), {'status': 'resolved', 'resolution_note': 'Teléfono actualizado'}, format='json')
    assert r.status_code == 200 and r.data['status'] == 'resolved'
    assert 'atendida' in mail.outbox[-1].subject and 'Teléfono actualizado' in mail.outbox[-1].body


@pytest.mark.django_db
def test_intake_requires_admin(auth_client):
    assert auth_client.post(reverse('legal-admin-arco-intake'), {'requester_email': 'x@x.mx', 'request_type': 'access'}, format='json').status_code == 403
