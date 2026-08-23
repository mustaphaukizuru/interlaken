"""P1-A4/A5: password request inbox; resolving sets a password and returns delivery texts."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.accounts.models import PasswordRequest
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(api_client):
    api_client.force_authenticate(user=AdminFactory())
    return api_client


def test_log_request_matches_user_by_email(admin_client):
    parent = ParentFactory(email='mom@test.mx')
    resp = admin_client.post(reverse('password-requests'), {
        'requested_email': 'MOM@test.mx', 'channel': 'whatsapp', 'requester_name': 'Mamá', 'note': 'Olvidó',
    }, format='json')
    assert resp.status_code == 201, resp.data
    assert resp.data['user'] == parent.pk and resp.data['status'] == 'open'
    listed = admin_client.get(reverse('password-requests'), {'status': 'open'}).data
    assert listed['open_count'] == 1 and listed['results'][0]['user_email'] == 'mom@test.mx'


def test_resolve_sets_password_audits_and_returns_templates(admin_client):
    parent = ParentFactory(email='dad@test.mx', first_name='Luis', whatsapp='5215500000000')
    req = PasswordRequest.objects.create(user=parent, requested_email=parent.email, channel='email')
    resp = admin_client.patch(reverse('password-request-detail', args=[req.pk]),
                              {'action': 'resolve', 'delivered_via': 'whatsapp'}, format='json')
    assert resp.status_code == 200, resp.data
    pw = resp.data['temporary_password']
    parent.refresh_from_db()
    assert parent.check_password(pw)
    assert resp.data['status'] == 'resolved' and resp.data['delivered_via'] == 'whatsapp'
    assert pw in resp.data['templates']['whatsapp_text'] and 'dad@test.mx' in resp.data['templates']['email_body']
    assert resp.data['whatsapp_number'] == '5215500000000'
    assert AuditLog.objects.filter(context='accounts.set_password').exists()
    # second resolve is refused
    assert admin_client.patch(reverse('password-request-detail', args=[req.pk]),
                              {'action': 'resolve'}, format='json').status_code == 409


def test_reject_and_unlinked_resolve(admin_client):
    req = PasswordRequest.objects.create(requested_email='nobody@test.mx', channel='phone')
    bad = admin_client.patch(reverse('password-request-detail', args=[req.pk]), {'action': 'resolve'}, format='json')
    assert bad.status_code == 400 and 'user' in bad.data
    ok = admin_client.patch(reverse('password-request-detail', args=[req.pk]),
                            {'action': 'reject', 'note': 'No identificado'}, format='json')
    assert ok.status_code == 200 and ok.data['status'] == 'rejected'


def test_admin_target_refused(admin_client):
    other_admin = AdminFactory()
    req = PasswordRequest.objects.create(user=other_admin, requested_email=other_admin.email)
    resp = admin_client.patch(reverse('password-request-detail', args=[req.pk]), {'action': 'resolve'}, format='json')
    assert resp.status_code == 403


def test_parent_forbidden(api_client):
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.get(reverse('password-requests')).status_code == 403
