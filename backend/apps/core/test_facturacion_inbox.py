"""P1-G6/G7: facturación request form and the contact inbox endpoints."""
import pytest
from django.core import mail
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.core.models import ContactMessage

pytestmark = pytest.mark.django_db

PAYLOAD = {
    'student': 'Ana Pérez López', 'razon_social': 'Luis Pérez', 'rfc': 'PELU800101AB1', 'cp': '54000',
    'regimen': 'Régimen simplificado de confianza', 'email': 'luis@test.mx', 'phone': '(55) 1234-5678',
}


def test_facturacion_request_emails_billing_and_stores_inbox_copy(api_client, settings):
    settings.BILLING_EMAIL = 'facturas@interlaken.com.mx'
    settings.RATELIMIT_ENABLE = False
    mail.outbox.clear()
    resp = api_client.post(reverse('facturacion-request'), PAYLOAD, format='json')
    assert resp.status_code == 201, resp.data
    to_billing = [m for m in mail.outbox if m.to == ['facturas@interlaken.com.mx']][0]
    assert to_billing.reply_to == ['luis@test.mx'] and 'PELU800101AB1' in to_billing.body
    assert any(m.to == ['luis@test.mx'] for m in mail.outbox)  # confirmation to requester
    msg = ContactMessage.objects.get()
    assert msg.subject.startswith('[Facturación]') and msg.is_handled is False


def test_facturacion_validation(api_client, settings):
    settings.RATELIMIT_ENABLE = False
    resp = api_client.post(reverse('facturacion-request'), {**PAYLOAD, 'rfc': 'X'}, format='json')
    assert resp.status_code == 400 and 'rfc' in resp.data


@pytest.mark.parametrize('field, value', [
    ('student', ''), ('razon_social', ''), ('regimen', 'Régimen inventado'),
    ('cp', '5400'), ('phone', '55 1234'), ('email', 'sin-arroba'),
])
def test_facturacion_requires_the_official_seven_fields(api_client, settings, field, value):
    settings.RATELIMIT_ENABLE = False
    resp = api_client.post(reverse('facturacion-request'), {**PAYLOAD, field: value}, format='json')
    assert resp.status_code == 400 and field in resp.data


def test_facturacion_body_lists_the_seven_fields(api_client, settings):
    settings.BILLING_EMAIL = 'facturas@interlaken.com.mx'
    settings.RATELIMIT_ENABLE = False
    mail.outbox.clear()
    assert api_client.post(reverse('facturacion-request'), PAYLOAD, format='json').status_code == 201
    body = [m for m in mail.outbox if m.to == ['facturas@interlaken.com.mx']][0].body
    for label in ('Nombre del alumno: Ana Pérez López', 'Razón social: Luis Pérez', 'RFC: PELU800101AB1',
                  'Código postal: 54000', 'Régimen fiscal: Régimen simplificado de confianza',
                  'Correo para enviar facturas: luis@test.mx', 'Teléfono de contacto: (55) 1234-5678'):
        assert label in body


def test_inbox_list_filter_and_handle(api_client):
    a = ContactMessage.objects.create(name='A', email='a@t.mx', subject='Hola', message='m')
    ContactMessage.objects.create(name='B', email='b@t.mx', subject='Adiós', message='m', is_handled=True)
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.get(reverse('core-contact-inbox')).status_code == 403
    api_client.force_authenticate(user=AdminFactory())
    rows = api_client.get(reverse('core-contact-inbox'), {'handled': '0'}).data['results']
    assert [r['id'] for r in rows] == [a.id]
    resp = api_client.patch(reverse('core-contact-handle', args=[a.id]), {'is_handled': True}, format='json')
    assert resp.status_code == 200 and resp.data['is_handled'] is True
    assert api_client.get(reverse('core-contact-inbox'), {'handled': '0'}).data['count'] == 0
