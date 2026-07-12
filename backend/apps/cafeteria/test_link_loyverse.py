"""
Roster ↔ Loyverse linking: match customers to students by matrícula
(= customer_code) and backfill loyverse_id. The matching is exact (never
mis-links one child's spending onto another) with an email fallback; writes only
on commit. The admin endpoint previews then persists, and fails soft (502) when
Loyverse is unreachable.
"""
import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.accounts.models import StudentProfile
from apps.cafeteria.services import link_students_to_loyverse

URL = reverse('link-loyverse')


def _cust(code='', cid='', email=''):
    return {'id': cid, 'customer_code': code, 'email': email}


@pytest.mark.django_db
class TestMatching:
    def test_links_by_matricula_on_commit(self):
        s = StudentProfileFactory(student_id='09628', loyverse_id='')
        report = link_students_to_loyverse(
            [_cust(code='09628', cid='uuid-abc')], commit=True)
        assert report['linked'] == 1
        s.refresh_from_db()
        assert s.loyverse_id == 'uuid-abc'

    def test_dry_run_writes_nothing(self):
        s = StudentProfileFactory(student_id='09628', loyverse_id='')
        report = link_students_to_loyverse([_cust(code='09628', cid='uuid-abc')])
        assert report['linked'] == 1 and report['commit'] is False
        s.refresh_from_db()
        assert s.loyverse_id == ''      # preview only

    def test_already_linked_is_noop(self):
        StudentProfileFactory(student_id='09628', loyverse_id='uuid-abc')
        report = link_students_to_loyverse(
            [_cust(code='09628', cid='uuid-abc')], commit=True)
        assert report['already_linked'] == 1 and report['linked'] == 0

    def test_conflict_skipped_without_overwrite(self):
        s = StudentProfileFactory(student_id='09628', loyverse_id='old-uuid')
        report = link_students_to_loyverse(
            [_cust(code='09628', cid='new-uuid')], commit=True)
        assert report['skipped_conflict'] == 1 and report['linked'] == 0
        s.refresh_from_db()
        assert s.loyverse_id == 'old-uuid'      # never silently repointed

    def test_overwrite_relinks(self):
        s = StudentProfileFactory(student_id='09628', loyverse_id='old-uuid')
        report = link_students_to_loyverse(
            [_cust(code='09628', cid='new-uuid')], overwrite=True, commit=True)
        assert report['linked'] == 1
        s.refresh_from_db()
        assert s.loyverse_id == 'new-uuid'

    def test_email_fallback_when_code_missing(self):
        s = StudentProfileFactory(student_id='NOPE', loyverse_id='')
        email = s.user.email
        report = link_students_to_loyverse(
            [_cust(code='0000', cid='uuid-email', email=email.upper())], commit=True)
        assert report['linked'] == 1
        s.refresh_from_db()
        assert s.loyverse_id == 'uuid-email'    # matched by email, case-insensitive

    def test_unmatched_student_reported(self):
        StudentProfileFactory(student_id='11111', loyverse_id='')
        report = link_students_to_loyverse([_cust(code='99999', cid='x')])
        assert report['linked'] == 0
        assert [u['matricula'] for u in report['unmatched_students']] == ['11111']
        assert report['unmatched_customer_count'] == 1

    def test_duplicate_customer_codes_flagged(self):
        StudentProfileFactory(student_id='09628', loyverse_id='')
        report = link_students_to_loyverse([
            _cust(code='09628', cid='first'),
            _cust(code='09628', cid='second'),
        ], commit=True)
        assert report['duplicate_codes'] == ['09628']
        # Deterministic: the FIRST customer with that code wins.
        assert StudentProfile.objects.get(student_id='09628').loyverse_id == 'first'


@pytest.mark.django_db
class TestLinkLoyverseEndpoint:
    def test_parent_forbidden(self, api_client, monkeypatch):
        monkeypatch.setattr('apps.accounts.loyverse_link.get_all_customers', lambda: [])
        api_client.force_authenticate(ParentFactory())
        assert api_client.post(URL, {'commit': '0'}, format='json').status_code == 403

    def test_admin_preview_then_commit(self, api_client, monkeypatch):
        StudentProfileFactory(student_id='09628', loyverse_id='')
        monkeypatch.setattr('apps.accounts.loyverse_link.get_all_customers',
                            lambda: [_cust(code='09628', cid='uuid-abc')])
        api_client.force_authenticate(AdminFactory())

        preview = api_client.post(URL, {'commit': '0'}, format='json')
        assert preview.status_code == 200 and preview.json()['linked'] == 1
        assert StudentProfile.objects.get(student_id='09628').loyverse_id == ''

        applied = api_client.post(URL, {'commit': '1'}, format='json')
        assert applied.status_code == 200
        assert StudentProfile.objects.get(student_id='09628').loyverse_id == 'uuid-abc'

    def test_loyverse_unreachable_is_502(self, api_client, monkeypatch):
        from apps.cafeteria.services import LoyverseError

        def boom():
            raise LoyverseError('401 Client Error')
        monkeypatch.setattr('apps.accounts.loyverse_link.get_all_customers', boom)
        api_client.force_authenticate(AdminFactory())
        resp = api_client.post(URL, {'commit': '1'}, format='json')
        assert resp.status_code == 502
        assert 'Loyverse' in resp.json()['error']
