"""
Staff analytics endpoint (IK-ADMIN items 6/9): access control, payload shape,
empty-safety, aggregation correctness, query budget and the 60s cache.
"""
from datetime import datetime, timedelta
from datetime import time as dt_time
from decimal import Decimal

import pytest
from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone

from apps.accounts.factories import StudentProfileFactory, UserFactory
from apps.accounts.models import User
from apps.admissions.models import PreRegistration, Registration, RegistrationDocument
from apps.cafeteria.models import CafeteriaTransaction
from apps.core.models import AuditLog
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

URL = reverse('staff-analytics')


@pytest.fixture(autouse=True)
def _clear_analytics_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def staff_user(db):
    return UserFactory(role=User.Role.STAFF, email='staff@interlaken.edu.mx')


class TestAccess:
    def test_anonymous_401(self, api_client):
        assert api_client.get(URL).status_code == 401

    def test_parent_403(self, api_client, parent_user):
        api_client.force_authenticate(parent_user)
        assert api_client.get(URL).status_code == 403

    def test_student_403(self, api_client, student_user):
        api_client.force_authenticate(student_user)
        assert api_client.get(URL).status_code == 403

    def test_staff_200(self, api_client, staff_user):
        api_client.force_authenticate(staff_user)
        assert api_client.get(URL).status_code == 200

    def test_admin_200(self, api_client, admin_user):
        api_client.force_authenticate(admin_user)
        assert api_client.get(URL).status_code == 200


class TestEmptySafety:
    """With zero rows in the DB the shapes must still render a dashboard."""

    def test_shape_with_no_data(self, api_client, staff_user):
        api_client.force_authenticate(staff_user)
        data = api_client.get(URL).json()

        assert set(data) == {'admissions', 'payments', 'cafeteria', 'documents',
                             'circulars', 'arco', 'range_days', 'generated_at'}
        assert data['range_days'] == 30
        # Funnels are zero-filled with every status key present.
        assert data['admissions']['pre_funnel'] == {
            'pending': 0, 'contacted': 0, 'enrolled': 0, 'rejected': 0}
        assert data['admissions']['reg_funnel']['draft'] == 0
        assert data['admissions']['referrals'] == []
        assert data['payments']['this_month'] == {'total': 0.0, 'count': 0}
        assert data['payments']['last_month_to_date'] == {'total': 0.0, 'count': 0}
        # No overdue-invoice KPI: the app does not bill tuition.
        assert 'overdue' not in data['payments']
        # Full 30-day series of zeros (all three daily series).
        assert len(data['admissions']['series']) == 30
        assert len(data['payments']['series']) == 30
        assert len(data['cafeteria']['series']) == 30
        assert all(p['topups'] == 0.0 and p['purchases'] == 0.0
                   for p in data['cafeteria']['series'])
        assert data['documents'] == {'in_review': 0}
        # No announcement read-tracking exists → read_rate is null by design.
        assert data['circulars'] == {'active': 0, 'read_rate': None}
        assert data['arco'] == {'open': 0, 'overdue': 0}


class TestAggregation:
    def test_counts_and_sums(self, api_client, staff_user):
        now = timezone.now()
        PreRegistration.objects.create(
            child_first_name='A', child_last_name='B', child_dob='2019-01-01',
            level='preescolar', grade_applying='K2', parent_name='P',
            parent_email='p@x.mx', parent_phone='555', referral_source='Facebook')
        PreRegistration.objects.create(
            child_first_name='C', child_last_name='D', child_dob='2018-01-01',
            level='primaria', grade_applying='1', parent_name='Q',
            parent_email='q@x.mx', parent_phone='556', referral_source='Facebook',
            status=PreRegistration.Status.CONTACTED)
        reg = Registration.objects.create(
            child_first_name='E', child_last_name='F', child_dob='2017-01-01',
            level='primaria', grade_applying='2', parent1_name='R',
            parent1_email='r@x.mx', parent1_phone='557',
            status=Registration.Status.SUBMITTED)
        RegistrationDocument.objects.create(
            registration=reg, doc_type='photo', file='admissions/1/x.jpg',
            filename='x.jpg', file_size=10)

        Payment.objects.create(amount=Decimal('1500.00'),
                               status=Payment.Status.SUCCESS,
                               payment_type='cafeteria', completed_at=now)
        profile = StudentProfileFactory()

        # loyverse_receipt_id is unique — give each test row a distinct one.
        CafeteriaTransaction.objects.create(
            student=profile, transaction_type=CafeteriaTransaction.TxType.TOPUP,
            amount=Decimal('200.00'), date=now, loyverse_receipt_id='t-topup-1')
        CafeteriaTransaction.objects.create(
            student=profile, transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('45.50'), date=now, loyverse_receipt_id='t-purchase-1')

        api_client.force_authenticate(staff_user)
        data = api_client.get(URL).json()

        assert data['admissions']['pre_funnel']['pending'] == 1
        assert data['admissions']['pre_funnel']['contacted'] == 1
        assert data['admissions']['reg_funnel']['submitted'] == 1
        assert data['admissions']['referrals'] == [{'source': 'Facebook', 'count': 2}]
        assert data['payments']['this_month'] == {'total': 1500.0, 'count': 1}
        today_point = data['cafeteria']['series'][-1]
        assert today_point['topups'] == 200.0
        assert today_point['purchases'] == 45.5
        assert data['admissions']['series'][-1]['count'] == 2
        assert data['payments']['series'][-1]['total'] == 1500.0
        assert data['documents']['in_review'] == 1


class TestMonthOverMonthWindow:
    """The MoM delta must compare this month-to-date against the SAME span of
    last month, not the full prior month (which fakes a decline early on)."""

    def _pay(self, day, amount):
        Payment.objects.create(
            amount=Decimal(amount), status=Payment.Status.SUCCESS,
            payment_type='cafeteria',
            completed_at=timezone.make_aware(datetime.combine(day, dt_time(12, 0))))

    def test_prev_month_to_date_is_a_clamped_prefix(self, api_client, staff_user):
        today = timezone.localdate()
        month_start = today.replace(day=1)
        prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
        last_day_prev = month_start - timedelta(days=1)

        self._pay(prev_month_start, '1000.00')  # first day → always in-window
        self._pay(last_day_prev, '500.00')      # last day → only when late in month

        api_client.force_authenticate(staff_user)
        pay = api_client.get(URL).json()['payments']

        # Full prior month sees both; to-date is a prefix that always includes
        # day 1 and never exceeds the full month.
        assert pay['last_month']['total'] == 1500.0
        assert pay['last_month_to_date']['total'] >= 1000.0
        assert pay['last_month_to_date']['total'] <= pay['last_month']['total']


class TestPerformanceAndCache:
    def test_query_budget_no_n_plus_1(self, api_client, staff_user,
                                      django_assert_max_num_queries):
        # Data volume must not change the query count (pure aggregation).
        profile = StudentProfileFactory()
        now = timezone.now()
        for i in range(25):
            PreRegistration.objects.create(
                child_first_name=f'N{i}', child_last_name='X',
                child_dob='2019-01-01', level='preescolar', grade_applying='K',
                parent_name='P', parent_email=f'p{i}@x.mx', parent_phone='5')
            CafeteriaTransaction.objects.create(
                student=profile,
                transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                amount=Decimal('10.00'), date=now - timedelta(days=i % 20),
                loyverse_receipt_id=f't-bulk-{i}')

        api_client.force_authenticate(staff_user)
        with django_assert_max_num_queries(13):
            assert api_client.get(URL).status_code == 200

    def test_second_call_served_from_cache(self, api_client, staff_user,
                                           django_assert_num_queries):
        api_client.force_authenticate(staff_user)
        assert api_client.get(URL).status_code == 200
        with django_assert_num_queries(0):
            assert api_client.get(URL).status_code == 200

    def test_reads_are_not_audit_logged(self, api_client, staff_user):
        api_client.force_authenticate(staff_user)
        before = AuditLog.objects.count()
        assert api_client.get(URL).status_code == 200
        assert AuditLog.objects.count() == before


class TestRangeParam:
    def test_seven_day_window(self, api_client, staff_user):
        api_client.force_authenticate(staff_user)
        data = api_client.get(URL, {'days': 7}).json()
        assert data['range_days'] == 7
        assert len(data['admissions']['series']) == 7
        assert len(data['payments']['series']) == 7
        assert len(data['cafeteria']['series']) == 7

    def test_unknown_values_fall_back_to_30(self, api_client, staff_user):
        api_client.force_authenticate(staff_user)
        for bad in ('999', 'abc', '-7'):
            data = api_client.get(URL, {'days': bad}).json()
            assert data['range_days'] == 30

    def test_ranges_are_cached_independently(self, api_client, staff_user,
                                             django_assert_num_queries):
        api_client.force_authenticate(staff_user)
        assert api_client.get(URL, {'days': 7}).status_code == 200
        assert api_client.get(URL, {'days': 90}).status_code == 200
        with django_assert_num_queries(0):
            assert api_client.get(URL, {'days': 7}).json()['range_days'] == 7
            assert api_client.get(URL, {'days': 90}).json()['range_days'] == 90
