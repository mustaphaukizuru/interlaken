"""
ARCO rights flow (IK-LEGAL B3): request lifecycle, statutory deadline, staff
console with audited status changes, and the Acceso data export.
"""
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.core.models import AuditLog
from apps.legal.models import ArcoRequest

pytestmark = pytest.mark.django_db


def test_parent_creates_request_with_statutory_deadline(api_client):
    parent = ParentFactory()
    api_client.force_authenticate(user=parent)
    resp = api_client.post(reverse('legal-arco'),
                           {'request_type': 'access', 'details': 'Quiero mis datos.'},
                           format='json')
    assert resp.status_code == 201, resp.data
    arco = ArcoRequest.objects.get(pk=resp.data['id'])
    assert arco.requester_email == parent.email
    assert arco.status == ArcoRequest.Status.RECEIVED
    # A statutory response deadline (20 business days) is set automatically.
    assert arco.statutory_deadline > timezone.now().date()


def test_parent_only_sees_own_requests(api_client):
    mine = ParentFactory()
    other = ParentFactory()
    ArcoRequest.objects.create(requester=other, requester_email=other.email,
                               request_type='access')
    api_client.force_authenticate(user=mine)
    ArcoRequest.objects.create(requester=mine, requester_email=mine.email,
                               request_type='opposition')
    resp = api_client.get(reverse('legal-arco'))
    rows = resp.data.get('results', resp.data)
    assert {r['requester_email'] for r in rows} == {mine.email}


def test_staff_advances_status_and_it_is_audited(api_client):
    parent = ParentFactory()
    arco = ArcoRequest.objects.create(requester=parent, requester_email=parent.email,
                                      request_type='cancellation')
    admin = AdminFactory()
    api_client.force_authenticate(user=admin)
    resp = api_client.post(reverse('legal-admin-arco-status', args=[arco.id]),
                           {'status': 'resolved', 'resolution_note': 'Atendida.'},
                           format='json')
    assert resp.status_code == 200, resp.data
    arco.refresh_from_db()
    assert arco.status == ArcoRequest.Status.RESOLVED
    assert arco.resolved_at is not None

    entry = AuditLog.objects.filter(
        object_type='legal.arcorequest', object_id=str(arco.id),
        action='update').latest('created_at')
    assert entry.changes['status'][1] == 'resolved'
    assert entry.actor_id == admin.id  # attributed to the acting staff member


def test_non_admin_cannot_use_staff_console(api_client):
    api_client.force_authenticate(user=ParentFactory())
    assert api_client.get(reverse('legal-admin-arco')).status_code == 403


def test_access_export_returns_only_own_household(api_client):
    parent = ParentFactory()
    kid = StudentProfileFactory(parents=[parent], grade='2° Primaria')
    StudentProfileFactory()  # someone else's child
    api_client.force_authenticate(user=parent)
    resp = api_client.get(reverse('legal-arco-export'))
    assert resp.status_code == 200
    assert resp.data['account']['email'] == parent.email
    exported_ids = {c['student_id'] for c in resp.data['children']}
    assert exported_ids == {kid.student_id}
    # No internal secrets leak into the export.
    assert 'session_token_hash' not in str(resp.data)
