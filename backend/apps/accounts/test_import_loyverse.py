"""Admin import-from-Loyverse endpoint: preview + commit (+ link)."""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile

URL = reverse('import-loyverse')


def _student_cust(code='09628', cid='uuid-abc', name='García López Ana',
                  email='ci09628@interlaken.com.mx', points=50):
    return {
        'id': cid,
        'customer_code': code,
        'name': name,
        'email': email,
        'address': '6APRI',
        'total_points': points,
    }


@pytest.mark.django_db
class TestImportLoyverseEndpoint:
    def test_parent_forbidden(self, api_client, monkeypatch):
        monkeypatch.setattr('apps.accounts.loyverse_import.get_all_customers', lambda: [])
        api_client.force_authenticate(ParentFactory())
        assert api_client.post(URL, {'commit': '0'}, format='json').status_code == 403

    def test_admin_preview_then_commit(self, api_client, monkeypatch):
        monkeypatch.setattr(
            'apps.accounts.loyverse_import.get_all_customers',
            lambda: [_student_cust()],
        )
        api_client.force_authenticate(AdminFactory())

        preview = api_client.post(URL, {'commit': '0'}, format='json')
        assert preview.status_code == 200
        assert preview.json()['import']['created'] == 1
        assert preview.json()['import']['commit'] is False
        assert StudentProfile.objects.filter(student_id='09628').count() == 0

        applied = api_client.post(URL, {'commit': '1'}, format='json')
        assert applied.status_code == 200
        assert applied.json()['import']['created'] == 1
        profile = StudentProfile.objects.get(student_id='09628')
        assert profile.loyverse_id == 'uuid-abc'

    def test_commit_also_links_existing_roster(self, api_client, monkeypatch):
        # Existing roster row (import path updates + sets loyverse_id; link is a
        # no-op already_linked). A second unmatched student proves the link pass.
        StudentProfileFactory(student_id='09628', loyverse_id='')
        StudentProfileFactory(student_id='09999', loyverse_id='')
        monkeypatch.setattr(
            'apps.accounts.loyverse_import.get_all_customers',
            lambda: [
                _student_cust(),
                _student_cust(code='09999', cid='uuid-999',
                              email='ci09999@interlaken.com.mx'),
            ],
        )
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(URL, {'commit': '1'}, format='json')
        assert resp.status_code == 200
        assert StudentProfile.objects.get(student_id='09628').loyverse_id == 'uuid-abc'
        assert StudentProfile.objects.get(student_id='09999').loyverse_id == 'uuid-999'
        # Both are linked after import; link pass reports them as already_linked.
        assert resp.json()['link']['already_linked'] >= 2

    def test_loyverse_unreachable_is_502(self, api_client, monkeypatch):
        from apps.cafeteria.services import LoyverseError

        def boom():
            raise LoyverseError('401 Client Error')
        monkeypatch.setattr('apps.accounts.loyverse_import.get_all_customers', boom)
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(URL, {'commit': '1'}, format='json')
        assert resp.status_code == 502
        assert 'Loyverse' in resp.json()['error']
