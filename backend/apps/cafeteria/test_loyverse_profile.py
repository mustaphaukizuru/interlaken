"""
Full Loyverse customer snapshot (IK-CAFE): parsing + upsert.

The SAMPLE is the real customer object returned by the Loyverse API for the
student on the POS card (sparse contact fields, full visit history).
"""
from decimal import Decimal

import pytest

from apps.accounts.factories import StudentProfileFactory
from apps.cafeteria.loyverse_profile import (parse_customer_snapshot,
                                             refresh_all_profiles,
                                             refresh_profiles_if_stale,
                                             upsert_loyverse_profile)
from apps.cafeteria.models import LoyverseProfile

pytestmark = pytest.mark.django_db

SAMPLE = {
    'id': '2076c9a6-6e8a-4be2-b892-ed594020447b',
    'name': 'Quintana Castilla Emma',
    'email': 'ci09824@interlaken.com.mx',
    'customer_code': '09824',
    'address': '4BPRI',
    'phone_number': None,
    'note': None,
    'first_visit': '2024-09-19T16:41:41.000Z',
    'last_visit': '2026-06-24T16:42:18.000Z',
    'total_visits': 36,
    'total_spent': 52.0,
    'total_points': 0.0,
    'created_at': '2024-08-23T16:28:51.000Z',
    'updated_at': '2026-06-24T16:42:27.000Z',
}


class TestParse:
    def test_maps_every_field(self):
        s = parse_customer_snapshot(SAMPLE)
        assert s['loyverse_id'] == '2076c9a6-6e8a-4be2-b892-ed594020447b'
        assert s['customer_code'] == '09824'
        assert s['name'] == 'Quintana Castilla Emma'
        assert s['email'] == 'ci09824@interlaken.com.mx'
        assert s['address_code'] == '4BPRI'
        assert s['total_visits'] == 36
        assert s['total_spent'] == Decimal('52.0')
        assert s['total_points'] == Decimal('0')
        assert s['first_visit'].year == 2024 and s['first_visit'].month == 9
        assert s['last_visit'].year == 2026
        assert s['raw'] == SAMPLE

    def test_sparse_fields_are_safe(self):
        # phone/note are None on the sample — must become '' not 'None'.
        s = parse_customer_snapshot(SAMPLE)
        assert s['phone_number'] == ''
        assert s['note'] == ''

    def test_empty_customer_does_not_crash(self):
        s = parse_customer_snapshot({})
        assert s['loyverse_id'] == ''
        assert s['total_visits'] == 0
        assert s['total_spent'] == Decimal('0')
        assert s['first_visit'] is None


class TestUpsert:
    def test_creates_then_refreshes_in_place(self):
        student = StudentProfileFactory(student_id='09824')

        profile, created = upsert_loyverse_profile(student, SAMPLE)
        assert created is True
        assert LoyverseProfile.objects.count() == 1
        assert profile.total_visits == 36
        assert profile.total_spent == Decimal('52.00')
        assert profile.synced_at is not None

        # A later sync with more visits refreshes the same row (no duplicate).
        newer = {**SAMPLE, 'total_visits': 37, 'total_spent': 61.5}
        profile2, created2 = upsert_loyverse_profile(student, newer)
        assert created2 is False
        assert LoyverseProfile.objects.count() == 1
        assert profile2.pk == profile.pk
        assert profile2.total_visits == 37
        assert profile2.total_spent == Decimal('61.50')


class TestRefreshAll:
    def test_matches_by_id_then_code(self):
        s_by_id = StudentProfileFactory(student_id='11111',
                                        loyverse_id='2076c9a6-6e8a-4be2-b892-ed594020447b')
        s_by_code = StudentProfileFactory(student_id='09824', loyverse_id='')
        # First customer matches s_by_id (by loyverse id, code differs);
        # second matches s_by_code (by matrícula).
        customers = [
            SAMPLE,
            {**SAMPLE, 'id': 'other-uuid', 'customer_code': '09824',
             'total_visits': 5},
        ]
        report = refresh_all_profiles(customers)
        assert report['matched'] == 2
        assert report['created'] == 2
        assert report['unmatched'] == 0
        assert LoyverseProfile.objects.filter(student=s_by_id).exists()
        assert LoyverseProfile.objects.get(student=s_by_code).total_visits == 5

    def test_unmatched_customers_counted(self):
        report = refresh_all_profiles([{**SAMPLE, 'id': 'x', 'customer_code': '99999'}])
        assert report['matched'] == 0
        assert report['unmatched'] == 1


class TestThrottle:
    def test_skips_when_fresh(self, monkeypatch):
        student = StudentProfileFactory(student_id='09824')
        upsert_loyverse_profile(student, SAMPLE)  # synced_at = now (fresh)

        def _boom(*a, **k):
            raise AssertionError('get_all_customers must not be called when fresh')
        monkeypatch.setattr('apps.cafeteria.services.get_all_customers', _boom)

        result = refresh_profiles_if_stale(max_age_hours=20)
        assert result['skipped'] is True
        assert result['reason'] == 'fresh'

    def test_runs_when_stale(self, monkeypatch):
        StudentProfileFactory(student_id='09824')  # no profile yet → stale
        monkeypatch.setattr('apps.cafeteria.services.get_all_customers',
                            lambda *a, **k: [SAMPLE])

        result = refresh_profiles_if_stale()
        assert result['skipped'] is False
        assert result['matched'] == 1
        assert result['total_customers'] == 1
        assert LoyverseProfile.objects.count() == 1

    def test_loyverse_error_is_soft(self, monkeypatch):
        StudentProfileFactory(student_id='09824')
        from apps.cafeteria.services import LoyverseError

        def _fail(*a, **k):
            raise LoyverseError('timeout')
        monkeypatch.setattr('apps.cafeteria.services.get_all_customers', _fail)

        result = refresh_profiles_if_stale()
        assert result['skipped'] is True
        assert result['reason'] == 'loyverse-error'
