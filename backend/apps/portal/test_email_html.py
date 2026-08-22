"""P1-C3/C8: send_email produces text + branded HTML with Reply-To; test command works."""
import pytest
from django.core import mail
from django.core.management import call_command

from apps.portal.services import send_email

pytestmark = pytest.mark.django_db


def test_send_email_is_multipart_with_reply_to(settings):
    settings.CONTACT_EMAIL = 'info@interlaken.com.mx'
    mail.outbox.clear()
    assert send_email('Hola <b>', 'Primera línea.\n\nSegunda & tercera.', ['x@test.mx'], cta_url='https://p/login')
    m = mail.outbox[0]
    assert m.to == ['x@test.mx'] and m.reply_to == ['info@interlaken.com.mx']
    assert 'Primera línea.' in m.body  # plain text primary
    html, ctype = m.alternatives[0]
    assert ctype == 'text/html'
    assert 'Colegio Interlaken' in html and 'Segunda &amp; tercera.' in html and 'Hola &lt;b&gt;' in html
    assert 'https://p/login' in html


def test_contact_form_reply_to_is_visitor(api_client, settings):
    settings.CONTACT_EMAIL = 'info@interlaken.com.mx'
    settings.RATELIMIT_ENABLE = False
    mail.outbox.clear()
    resp = api_client.post('/api/v1/contact/', {
        'name': 'Visitante', 'email': 'v@test.mx', 'subject': 'Informes', 'message': 'Hola',
    }, format='json')
    assert resp.status_code in (200, 201), resp.data
    assert mail.outbox[-1].reply_to == ['v@test.mx'] and mail.outbox[-1].to == ['info@interlaken.com.mx']


def test_send_test_email_command():
    mail.outbox.clear()
    call_command('send_test_email', '--to', 'ops@test.mx')
    assert mail.outbox[-1].to == ['ops@test.mx'] and mail.outbox[-1].alternatives
