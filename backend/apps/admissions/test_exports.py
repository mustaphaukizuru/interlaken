import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory
from apps.admissions.models import PreRegistration
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


def _pre(**o):
    base = dict(child_first_name='Ana', child_last_name='Pérez', child_dob='2020-01-01', level='preschool',
                grade_applying='Preescolar 1°', parent_name='Luis', parent_email='l@test.mx', parent_phone='55')
    base.update(o)
    return PreRegistration.objects.create(**base)


def test_preregistration_export_csv_and_audit(api_client):
    _pre()
    _pre(status='contacted', child_first_name='Beto')
    api_client.force_authenticate(user=AdminFactory())
    resp = api_client.get(reverse('pre-register-export'), {'status': 'contacted'})
    assert resp.status_code == 200 and resp['Content-Type'].startswith('text/csv')
    body = resp.content.decode('utf-8-sig')
    assert 'Beto' in body and 'Ana' not in body
    assert AuditLog.objects.filter(context='admissions.export').exists()


def test_exports_forbidden_for_families(api_client):
    api_client.force_authenticate(user=ParentFactory())
    for name in ('pre-register-export', 'register-export', 'core-admin-audit-export'):
        assert api_client.get(reverse(name)).status_code == 403


def test_audit_export(api_client):
    api_client.force_authenticate(user=AdminFactory())
    _pre()  # creates audit rows via signals
    resp = api_client.get(reverse('core-admin-audit-export'))
    assert resp.status_code == 200 and resp.content.decode('utf-8-sig').startswith('Fecha,')
