"""Parent portal: list registrations linked by email for status tracking."""
import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory
from apps.admissions.models import Registration

pytestmark = pytest.mark.django_db


def _reg(**over):
    data = dict(
        child_first_name='Ana', child_last_name='Pérez', child_dob='2012-03-04',
        level='primaria', grade_applying='Primaria 2°',
        parent1_name='Roberto Pérez', parent1_email='rp@test.mx',
        parent1_phone='5551234567', status=Registration.Status.SUBMITTED,
    )
    data.update(over)
    return Registration.objects.create(**data)


class TestMyRegistrations:
    def test_lists_regs_matching_parent_email(self, api_client):
        parent = ParentFactory(email='rp@test.mx')
        mine = _reg(parent1_email='rp@test.mx', status=Registration.Status.REVIEWING)
        _reg(parent1_email='other@test.mx')  # unrelated
        api_client.force_authenticate(parent)

        resp = api_client.get(reverse('my-registrations'))
        assert resp.status_code == 200, resp.content
        ids = [r['id'] for r in resp.json()]
        assert ids == [mine.id]
        row = resp.json()[0]
        assert row['status'] == 'reviewing'
        assert row['status_label']
        assert row['child_name'] == 'Ana Pérez'
        assert 'blood_type' not in row

    def test_matches_parent2_email_case_insensitive(self, api_client):
        parent = ParentFactory(email='tutor@test.mx')
        mine = _reg(
            parent1_email='madre@test.mx',
            parent2_email='Tutor@Test.mx',
            status=Registration.Status.APPROVED,
        )
        api_client.force_authenticate(parent)

        resp = api_client.get(reverse('my-registrations'))
        assert resp.status_code == 200
        assert [r['id'] for r in resp.json()] == [mine.id]

    def test_anonymous_gets_401(self, api_client):
        resp = api_client.get(reverse('my-registrations'))
        assert resp.status_code in (401, 403)
