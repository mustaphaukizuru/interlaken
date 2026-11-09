"""A JSON body that is not an object is a 400, never a 500 (pre-launch, 2026-11-09)."""
import pytest
from django.urls import reverse

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize('body', ['[]', '[1, 2]', '"hola"', '42', 'null'])
@pytest.mark.parametrize('route', ['contact-create', 'token-obtain'])
def test_a_non_object_json_body_is_a_400(api_client, route, body):
    r = api_client.generic('POST', reverse(route), body, content_type='application/json')
    assert r.status_code == 400, r.content


def test_an_object_still_works(api_client):
    r = api_client.post(reverse('token-obtain'), {'email': 'nadie@test.mx', 'password': 'x'}, format='json')
    assert r.status_code == 401


def test_the_loyverse_webhook_still_acknowledges_a_non_object_body(api_client, settings):
    # A 400 could make Loyverse disable the webhook; it keeps answering 200.
    settings.LOYVERSE_WEBHOOK_SECRET = 's3cr3t'
    r = api_client.generic('POST', reverse('cafeteria-loyverse-webhook-token', args=['s3cr3t']), '[]',
                           content_type='application/json')
    assert r.status_code == 200, r.content
