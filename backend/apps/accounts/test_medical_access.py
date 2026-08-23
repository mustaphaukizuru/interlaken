import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.accounts.medical import MASK, mask_medical, medical_access
from apps.accounts.models import User
from apps.legal.models import ConsentPurpose
from apps.legal.services import record_consent


@pytest.fixture
def kid(db):
    sp = StudentProfileFactory(allergies='Nuez', blood_type='O+', medical_notes='Asma leve')
    return sp


@pytest.mark.django_db
def test_policy_by_role_and_consent(kid, admin_user):
    parent = ParentFactory()
    kid.parents.add(parent)
    staff = User.objects.create_user(email='s@test.mx', password='x-pass-1234', first_name='S', last_name='T', role=User.Role.STAFF)
    assert medical_access(admin_user, kid) == (True, '')
    assert medical_access(staff, kid) == (False, 'role')
    assert medical_access(parent, kid) == (False, 'consent_required')
    record_consent(guardian=parent, purpose=ConsentPurpose.MEDICAL_DATA, granted=True, student=kid)
    assert medical_access(parent, kid) == (True, '')
    other = ParentFactory()
    assert medical_access(other, kid) == (False, 'role')


@pytest.mark.django_db
def test_detail_masks_until_consent_and_admin_sees_all(kid, admin_client):
    parent = ParentFactory()
    kid.parents.add(parent)
    c = APIClient()
    c.force_authenticate(parent)
    url = reverse('student-detail', args=[kid.pk])
    d = c.get(url).data
    assert d['allergies'] == MASK and d['medical_masked'] == 'consent_required'
    record_consent(guardian=parent, purpose=ConsentPurpose.MEDICAL_DATA, granted=True, student=kid)
    d = c.get(url).data
    assert d['allergies'] == 'Nuez' and 'medical_masked' not in d
    assert admin_client.get(url).data['medical_notes'] == 'Asma leve'


@pytest.mark.django_db
def test_exports_never_carry_medical(kid, admin_client):
    csv = admin_client.get(reverse('export-students')).content.decode('utf-8-sig')
    assert 'Nuez' not in csv and 'Asma' not in csv
    assert mask_medical({'allergies': 'Nuez', 'grade': '1'}) == {'allergies': MASK, 'grade': '1'}
