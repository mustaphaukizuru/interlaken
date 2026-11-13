"""Families (hermanos), 2026-11-13: one login sees every sibling, nobody else does.

Every family-portal endpoint is pinned for the three logins that matter:
the school-email login of one sibling (``la``), a Padre/Tutor account linked
to that sibling only (``parent``), and an unrelated family (``lc``).
"""
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory, StudentUserFactory
from apps.accounts.families import dissolve_family, link_students
from apps.accounts.family import can_access_student, family_students
from apps.accounts.medical import medical_access
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction, TopUpRequest
from apps.legal.models import ConsentPurpose
from apps.legal.services import record_consent
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


def _kid(email, first, last='Pérez López', **kw):
    """A student whose family signs in with the student's own address (importer shape)."""
    login = StudentUserFactory(email=email, first_name=first, last_name=last)
    profile = StudentProfileFactory(user=login, **kw)
    profile.parents.add(login)
    return login, profile


@pytest.fixture
def fam():
    la, pa = _kid('ci00001@interlaken.com.mx', 'Ana')
    lb, pb = _kid('ci00002@interlaken.com.mx', 'Luis', grade='1° Secundaria', group='B')
    lc, pc = _kid('ci00003@interlaken.com.mx', 'Otro', last='Ruiz Soto')
    parent = ParentFactory(email='mama@correo.mx')
    pa.parents.add(parent)
    link_students([pa.pk, pb.pk], notify=False)
    for p in (pa, pb, pc):
        p.refresh_from_db()
        CafeteriaBalance.objects.create(student=p, balance=Decimal('100'))
    return {'la': la, 'pa': pa, 'lb': lb, 'pb': pb, 'lc': lc, 'pc': pc, 'parent': parent}


def _ids(body):
    rows = body.get('results', body) if isinstance(body, dict) else body
    return sorted(r['id'] for r in rows)


class TestRule:
    def test_family_students_reaches_every_sibling_once(self, fam):
        for login in (fam['la'], fam['lb'], fam['parent']):
            qs = family_students(login)
            assert sorted(qs.values_list('pk', flat=True)) == sorted([fam['pa'].pk, fam['pb'].pk])
            assert qs.count() == 2  # no duplicate rows from the guardian join
        assert list(family_students(fam['lc']).values_list('pk', flat=True)) == [fam['pc'].pk]

    def test_without_a_family_a_login_sees_only_its_own_child(self, fam):
        dissolve_family(fam['pa'].family)
        assert list(family_students(fam['la']).values_list('pk', flat=True)) == [fam['pa'].pk]
        assert list(family_students(fam['lb']).values_list('pk', flat=True)) == [fam['pb'].pk]
        assert list(family_students(fam['parent']).values_list('pk', flat=True)) == [fam['pa'].pk]

    def test_can_access_student(self, fam):
        assert can_access_student(fam['la'], fam['pb'])
        assert not can_access_student(fam['lc'], fam['pb'])
        assert not can_access_student(None, fam['pb'])


class TestStudentsAndDashboard:
    def test_students_list_and_detail(self, api_client, fam):
        api_client.force_authenticate(user=fam['la'])
        assert _ids(api_client.get(reverse('students')).data) == sorted([fam['pa'].pk, fam['pb'].pk])
        assert api_client.get(reverse('student-detail', args=[fam['pb'].pk])).status_code == 200
        assert api_client.get(reverse('student-detail', args=[fam['pc'].pk])).status_code == 404

    def test_outsider_does_not_see_the_family(self, api_client, fam):
        api_client.force_authenticate(user=fam['lc'])
        assert _ids(api_client.get(reverse('students')).data) == [fam['pc'].pk]
        assert api_client.get(reverse('student-detail', args=[fam['pb'].pk])).status_code == 404

    def test_dashboard_lists_both_children(self, api_client, fam):
        api_client.force_authenticate(user=fam['lb'])
        body = api_client.get(reverse('dashboard')).data
        assert sorted(c['id'] for c in body['children']) == sorted([fam['pa'].pk, fam['pb'].pk])
        assert body['children_count'] == 2
        assert sorted(b['student'] for b in body['cafeteria_balances']) == sorted([fam['pa'].pk, fam['pb'].pk])


class TestCafeteria:
    def test_balance_is_a_list_for_a_linked_login(self, api_client, fam):
        api_client.force_authenticate(user=fam['la'])
        body = api_client.get(reverse('cafeteria-balance')).data
        assert isinstance(body, list)
        assert sorted(b['student']['id'] for b in body) == sorted([fam['pa'].pk, fam['pb'].pk])

    def test_balance_stays_one_object_for_a_single_child_login(self, api_client, fam):
        api_client.force_authenticate(user=fam['lc'])
        body = api_client.get(reverse('cafeteria-balance')).data
        assert isinstance(body, dict) and body['student']['id'] == fam['pc'].pk

    def test_transactions_trend_and_categories_of_the_sibling(self, api_client, fam):
        CafeteriaTransaction.objects.create(
            student=fam['pb'], transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('35'), balance_after=Decimal('65'), loyverse_receipt_id='r-1')
        api_client.force_authenticate(user=fam['la'])
        rows = api_client.get(reverse('cafeteria-transactions'), {'student': fam['pb'].pk}).data['results']
        assert [r['student_id'] for r in rows] == [fam['pb'].pk]
        trend = api_client.get(reverse('cafeteria-spending-trend'), {'student': fam['pb'].pk}).data
        assert trend['total'] == 35.0
        cats = api_client.get(reverse('cafeteria-spending-categories'), {'student': fam['pb'].pk}).data
        assert cats['total'] == 35.0

        api_client.force_authenticate(user=fam['lc'])
        assert api_client.get(reverse('cafeteria-transactions'), {'student': fam['pb'].pk}).data['results'] == []
        assert api_client.get(reverse('cafeteria-spending-trend'), {'student': fam['pb'].pk}).data['total'] == 0

    def test_cards_cover_both_children(self, api_client, fam):
        api_client.force_authenticate(user=fam['la'])
        cards = api_client.get(reverse('cafeteria-cards')).data
        assert sorted(c['student']['id'] for c in cards) == sorted([fam['pa'].pk, fam['pb'].pk])

    def test_threshold_and_budget_for_the_sibling(self, api_client, fam):
        api_client.force_authenticate(user=fam['la'])
        url = reverse('cafeteria-threshold', args=[fam['pb'].pk])
        assert api_client.patch(url, {'threshold': '30'}, format='json').status_code == 200
        assert CafeteriaBalance.objects.get(student=fam['pb']).low_balance_threshold == Decimal('30')
        budget = reverse('cafeteria-budget', args=[fam['pb'].pk])
        assert api_client.patch(budget, {'daily_spend_limit': '80'}, format='json').status_code == 200

        api_client.force_authenticate(user=fam['lc'])
        assert api_client.patch(url, {'threshold': '10'}, format='json').status_code == 403
        assert api_client.patch(budget, {'daily_spend_limit': '5'}, format='json').status_code == 403

    def test_topup_permission_reaches_the_sibling(self, api_client, fam):
        body = {'student': fam['pb'].pk, 'amount': '100', 'method': 'office'}
        api_client.force_authenticate(user=fam['lc'])
        assert api_client.post(reverse('cafeteria-topup'), body, format='json').status_code == 403
        api_client.force_authenticate(user=fam['la'])
        resp = api_client.post(reverse('cafeteria-topup'), body, format='json')
        # Past the family check: families pay by card, so «office» is refused for its own reason.
        assert resp.status_code != 403, resp.data

    def test_monthly_statement_of_the_sibling(self, api_client, fam):
        api_client.force_authenticate(user=fam['la'])
        assert api_client.get(reverse('cafeteria-statement'), {'student': fam['pb'].pk}).status_code == 200
        api_client.force_authenticate(user=fam['lc'])
        assert api_client.get(reverse('cafeteria-statement'), {'student': fam['pb'].pk}).status_code == 404


class TestPaymentsLegalAndFeed:
    def test_payment_history_includes_the_siblings_topups(self, api_client, fam):
        topup = TopUpRequest.objects.create(student=fam['pb'], amount=Decimal('100'),
                                            method=TopUpRequest.Method.ONLINE,
                                            status=TopUpRequest.Status.COMPLETED)
        pay = Payment.objects.create(user=fam['lb'], payment_type=Payment.Type.CAFETERIA,
                                     amount=Decimal('100'), related_topup=topup,
                                     status=Payment.Status.SUCCESS)
        api_client.force_authenticate(user=fam['la'])
        assert pay.pk in _ids(api_client.get(reverse('payment-history')).data)
        api_client.force_authenticate(user=fam['lc'])
        assert pay.pk not in _ids(api_client.get(reverse('payment-history')).data)

    def test_consent_for_the_sibling(self, api_client, fam):
        api_client.force_authenticate(user=fam['la'])
        assert api_client.get(reverse('legal-consent'), {'student': fam['pb'].pk}).status_code == 200
        api_client.force_authenticate(user=fam['lc'])
        assert api_client.get(reverse('legal-consent'), {'student': fam['pb'].pk}).status_code == 404

    def test_arco_export_lists_every_child(self, api_client, fam):
        api_client.force_authenticate(user=fam['la'])
        body = api_client.get(reverse('legal-arco-export')).data
        names = {c.get('name') or c.get('full_name') or str(c) for c in body['children']}
        assert len(body['children']) == 2, names

    def test_novedades_show_the_siblings_movements(self, api_client, fam):
        CafeteriaTransaction.objects.create(
            student=fam['pb'], transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal('20'), balance_after=Decimal('80'), loyverse_receipt_id='r-2')
        api_client.force_authenticate(user=fam['la'])
        body = api_client.get(reverse('novedades')).data
        items = body.get('items', body) if isinstance(body, dict) else body
        assert any('Luis' in i['title'] for i in items if i['type'] == 'cafeteria')


class TestMedical:
    def test_guardian_of_one_sibling_reads_the_other_with_consent(self, fam):
        parent, pb = fam['parent'], fam['pb']
        assert medical_access(parent, pb) == (False, 'consent_required')
        record_consent(guardian=parent, purpose=ConsentPurpose.MEDICAL_DATA, granted=True, student=pb)
        assert medical_access(parent, pb) == (True, '')

    def test_unrelated_guardian_never_reads_it(self, fam):
        stranger = ParentFactory()
        record_consent(guardian=stranger, purpose=ConsentPurpose.MEDICAL_DATA, granted=True)
        assert medical_access(stranger, fam['pb'])[0] is False


class TestRelinking:
    def test_unlinking_takes_the_access_away(self, api_client, fam):
        dissolve_family(fam['pa'].family)
        api_client.force_authenticate(user=fam['la'])
        assert _ids(api_client.get(reverse('students')).data) == [fam['pa'].pk]
        assert api_client.get(reverse('student-detail', args=[fam['pb'].pk])).status_code == 404
        assert api_client.patch(reverse('cafeteria-threshold', args=[fam['pb'].pk]),
                                {'threshold': '30'}, format='json').status_code == 403

    def test_a_third_sibling_joins_the_same_view(self, api_client, fam):
        _, pd = _kid('ci00004@interlaken.com.mx', 'Sofía')
        link_students([pd.pk], family_id=fam['pa'].family_id, notify=False)
        api_client.force_authenticate(user=fam['parent'])
        assert _ids(api_client.get(reverse('students')).data) == sorted([fam['pa'].pk, fam['pb'].pk, pd.pk])
