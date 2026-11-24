"""QA sweep 2026-11-24: public forms (contacto, facturación, pre-registro) check
e-mail addresses for real, refuse line breaks in anything that reaches an
e-mail header and bound their free text. Valid submissions are unchanged."""
import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone

from apps.admissions.models import PreRegistration
from apps.core.models import ContactMessage

pytestmark = pytest.mark.django_db

CONTACT = {'name': 'Luis Pérez', 'email': 'luis@test.mx', 'subject': 'Informes',
           'message': 'Quisiera información de primaria.'}
FACTURA = {
    'student': 'Ana Pérez López', 'razon_social': 'Luis Pérez', 'rfc': 'PELU800101AB1', 'cp': '54000',
    'regimen': 'Régimen simplificado de confianza', 'email': 'luis@test.mx', 'phone': '(55) 1234-5678',
}


@pytest.fixture(autouse=True)
def _no_ratelimit(settings):
    settings.RATELIMIT_ENABLE = False


class TestContact:
    def test_valid_message_still_works(self, api_client):
        mail.outbox.clear()
        resp = api_client.post(reverse('contact-create'), CONTACT, format='json')
        assert resp.status_code == 201, resp.data
        assert ContactMessage.objects.count() == 1
        assert any(m.subject == '[Contacto web] Informes' for m in mail.outbox)

    @pytest.mark.parametrize('field', ['subject', 'name'])
    @pytest.mark.parametrize('brk', ['\r\nBcc: x@evil.test', '\nX: y', ' y'])
    def test_line_breaks_in_header_fields_are_400(self, api_client, field, brk):
        resp = api_client.post(reverse('contact-create'),
                               {**CONTACT, field: f'Hola{brk}'}, format='json')
        assert resp.status_code == 400 and field in resp.data
        assert not ContactMessage.objects.exists()

    def test_line_breaks_in_the_message_body_are_fine(self, api_client):
        resp = api_client.post(reverse('contact-create'),
                               {**CONTACT, 'message': 'Línea uno.\nLínea dos.'}, format='json')
        assert resp.status_code == 201, resp.data

    def test_message_is_bounded(self, api_client):
        resp = api_client.post(reverse('contact-create'),
                               {**CONTACT, 'message': 'x' * 5001}, format='json')
        assert resp.status_code == 400 and 'message' in resp.data
        ok = api_client.post(reverse('contact-create'),
                             {**CONTACT, 'message': 'x' * 5000}, format='json')
        assert ok.status_code == 201

    def test_bad_email_is_400(self, api_client):
        resp = api_client.post(reverse('contact-create'),
                               {**CONTACT, 'email': 'luis@test.mx\nBcc: x@evil.test'}, format='json')
        assert resp.status_code == 400 and 'email' in resp.data


class TestFacturacion:
    @pytest.mark.parametrize('email', ['a@', '@test.mx', 'luis @test.mx', 'luis@test',
                                       'luis@test.mx\r\nBcc: x@evil.test'])
    def test_invalid_email_is_400(self, api_client, email):
        resp = api_client.post(reverse('facturacion-request'), {**FACTURA, 'email': email},
                               format='json')
        assert resp.status_code == 400 and 'email' in resp.data
        assert not ContactMessage.objects.exists()

    def test_line_break_in_razon_social_is_400(self, api_client):
        mail.outbox.clear()
        resp = api_client.post(reverse('facturacion-request'),
                               {**FACTURA, 'razon_social': 'Luis\r\nBcc: x@evil.test'}, format='json')
        assert resp.status_code == 400 and 'razon_social' in resp.data
        assert mail.outbox == []

    def test_overlong_field_is_400(self, api_client):
        resp = api_client.post(reverse('facturacion-request'),
                               {**FACTURA, 'student': 'A' * 301}, format='json')
        assert resp.status_code == 400 and 'student' in resp.data

    def test_non_object_body_is_400(self, api_client):
        resp = api_client.post(reverse('facturacion-request'), ['x'], format='json')
        assert resp.status_code == 400

    def test_valid_request_still_works(self, api_client):
        resp = api_client.post(reverse('facturacion-request'), FACTURA, format='json')
        assert resp.status_code == 201, resp.data


def _prereg(**over):
    year = timezone.localdate().year
    base = {
        'child_name': 'Ana Pérez', 'child_dob': f'{year - 6}-03-15', 'grade_applying': 'Primaria 1°',
        'parent_name': 'Luis Pérez', 'email': 'luis@test.mx', 'phone': '5512345678',
    }
    base.update(over)
    return base


class TestPreRegistro:
    def test_message_is_bounded(self, api_client):
        resp = api_client.post(reverse('pre-register'), _prereg(message='x' * 5001), format='json')
        assert resp.status_code == 400 and 'message' in resp.data
        assert not PreRegistration.objects.exists()

    def test_overlong_last_names_are_400(self, api_client):
        resp = api_client.post(reverse('pre-register'),
                               _prereg(child_name='Ana ' + 'Pérez ' * 20), format='json')
        assert resp.status_code == 400 and 'child_name' in resp.data

    def test_valid_submission_still_works(self, api_client):
        resp = api_client.post(reverse('pre-register'),
                               _prereg(message='Nos interesa visitar.'), format='json')
        assert resp.status_code == 201, resp.data
        lead = PreRegistration.objects.get()
        assert (lead.child_first_name, lead.child_last_name) == ('Ana', 'Pérez')
