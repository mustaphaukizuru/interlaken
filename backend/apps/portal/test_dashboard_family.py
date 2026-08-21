"""Portal dashboard family-login shape for school-email students."""

from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.factories import ParentFactory, StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, TopUpRequest
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db


def _family(*, self_guardian=False, parents=None, balance='0.00'):
    """Build one family: a StudentProfile, its wallet, and a paid top-up.

    ``self_guardian=True`` reproduces the shared-email shape the school
    actually uses — the alumno's own User sits on ``student.parents``, so one
    ``<matricula>@alumnos.interlaken.edu.mx`` login sees the child's data.
    """
    student = StudentProfileFactory(parents=parents or [])
    if self_guardian:
        student.parents.add(student.user)
    wallet = CafeteriaBalance.objects.create(student=student, balance=Decimal(balance))
    topup = TopUpRequest.objects.create(
        student=student, amount=Decimal('100.00'), method=TopUpRequest.Method.ONLINE)
    payment = Payment.objects.create(
        user=student.user, payment_type=Payment.Type.CAFETERIA,
        amount=Decimal('100.00'), related_topup=topup, status=Payment.Status.SUCCESS)
    return student, wallet, payment


class TestDashboardFamilyLogin:
    def test_student_without_self_guardian_gets_family_payload(self, api_client):
        """Missing parents M2M still yields children[] for ParentDashboard."""
        student = StudentProfileFactory()  # no parents.add(self)
        api_client.force_authenticate(user=student.user)

        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == 1
        assert resp.data["children"][0]["id"] == student.id
        assert resp.data["children"][0]["student_id"] == student.student_id
        assert "cafeteria_balances" in resp.data
        assert resp.data["needs_family_link"] is False
        # Tuition billing removed — the dashboard must not expose invoice keys.
        assert "pending_invoices" not in resp.data
        assert "pending_balance" not in resp.data
        # Legacy thin student-only keys must not be the only shape.
        assert "cafeteria_balance" not in resp.data

    def test_self_guardian_student_gets_family_payload(self, api_client):
        student = StudentProfileFactory()
        student.parents.add(student.user)
        api_client.force_authenticate(user=student.user)

        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == 1
        assert resp.data["children"][0]["id"] == student.id
        assert resp.data["needs_family_link"] is False

    def test_parent_without_linked_students_gets_stable_empty_family_payload(self, api_client):
        parent = ParentFactory()
        api_client.force_authenticate(user=parent)

        resp = api_client.get(reverse("dashboard"))
        assert resp.status_code == 200
        assert resp.data["children_count"] == 0
        assert resp.data["children"] == []
        assert resp.data["cafeteria_balances"] == []
        assert resp.data["recent_payments"] == []
        assert resp.data["needs_family_link"] is True
        assert "announcements" in resp.data
        assert "unread_notifications" in resp.data


class TestFamilyDataScoping:
    """What one family login may read — and, above all, may not.

    These assert *exactly*, not *at least*: an "includes my child" test passes
    happily on an endpoint that returns the whole school, so every case below
    also builds a second, unrelated family and asserts its rows are absent.
    """

    def test_self_guardian_student_sees_exactly_its_own_student_balance_and_payments(
        self, api_client
    ):
        mine, my_wallet, my_payment = _family(self_guardian=True, balance='120.50')
        theirs, their_wallet, their_payment = _family(self_guardian=True, balance='999.00')

        api_client.force_authenticate(user=mine.user)

        dash = api_client.get(reverse('dashboard'))
        assert dash.status_code == 200
        assert [c['id'] for c in dash.data['children']] == [mine.id]
        assert [b['balance'] for b in dash.data['cafeteria_balances']] == ['120.50']
        assert [p['id'] for p in dash.data['recent_payments']] == [my_payment.id]

        # Cafeteria wallet: the student role returns a single own-wallet object.
        wallet = api_client.get(reverse('cafeteria-balance'))
        assert wallet.status_code == 200
        assert wallet.data['id'] == my_wallet.id
        assert wallet.data['student']['id'] == mine.id
        assert their_wallet.id != wallet.data['id']

        rows = api_client.get(reverse('payment-history')).data
        rows = rows.get('results', rows)
        assert [r['id'] for r in rows] == [my_payment.id]

        # Direct object access to the other family is a 404, not a 403 (no
        # existence oracle).
        assert api_client.get(
            reverse('payment-detail', args=[their_payment.id])).status_code == 404
        assert api_client.get(
            reverse('student-detail', args=[theirs.id])).status_code == 404
        assert api_client.get(
            reverse('student-detail', args=[mine.id])).status_code == 200

    def test_parent_with_two_children_sees_exactly_those_two(self, api_client):
        parent = ParentFactory(email='dos-hijos@test.mx')
        first, first_wallet, first_payment = _family(parents=[parent], balance='10.00')
        second, second_wallet, second_payment = _family(parents=[parent], balance='20.00')
        other, other_wallet, other_payment = _family(self_guardian=True, balance='30.00')

        api_client.force_authenticate(user=parent)

        dash = api_client.get(reverse('dashboard'))
        assert dash.status_code == 200
        assert dash.data['children_count'] == 2
        assert sorted(c['id'] for c in dash.data['children']) == sorted([first.id, second.id])
        assert sorted(b['balance'] for b in dash.data['cafeteria_balances']) == ['10.00', '20.00']
        assert sorted(p['id'] for p in dash.data['recent_payments']) == sorted(
            [first_payment.id, second_payment.id])

        wallets = api_client.get(reverse('cafeteria-balance'))
        assert wallets.status_code == 200
        assert sorted(w['id'] for w in wallets.data) == sorted(
            [first_wallet.id, second_wallet.id])
        assert other_wallet.id not in [w['id'] for w in wallets.data]

        rows = api_client.get(reverse('payment-history')).data
        rows = rows.get('results', rows)
        assert sorted(r['id'] for r in rows) == sorted(
            [first_payment.id, second_payment.id])

        students = api_client.get(reverse('students')).data
        students = students.get('results', students)
        assert sorted(s['id'] for s in students) == sorted([first.id, second.id])
        assert api_client.get(
            reverse('student-detail', args=[other.id])).status_code == 404
        assert api_client.get(
            reverse('payment-detail', args=[other_payment.id])).status_code == 404

    def test_neither_family_sees_the_other_cafeteria_transactions(self, api_client):
        from apps.cafeteria.models import CafeteriaTransaction

        parent = ParentFactory(email='tx-scope@test.mx')
        mine, my_wallet, _ = _family(parents=[parent], balance='50.00')
        theirs, their_wallet, _ = _family(self_guardian=True, balance='50.00')

        # loyverse_receipt_id is unique — give each row its own.
        mine_tx = CafeteriaTransaction.objects.create(
            student=mine, amount=Decimal('25.00'),
            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            balance_after=Decimal('25.00'), loyverse_receipt_id='rcpt-mine')
        theirs_tx = CafeteriaTransaction.objects.create(
            student=theirs, amount=Decimal('25.00'),
            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            balance_after=Decimal('25.00'), loyverse_receipt_id='rcpt-theirs')

        api_client.force_authenticate(user=parent)
        rows = api_client.get(reverse('cafeteria-transactions')).data
        rows = rows.get('results', rows)
        ids = [r['id'] for r in rows]
        assert ids == [mine_tx.id]

        # And the mirror direction: the other family's own login.
        api_client.force_authenticate(user=theirs.user)
        rows = api_client.get(reverse('cafeteria-transactions')).data
        rows = rows.get('results', rows)
        assert [r['id'] for r in rows] == [theirs_tx.id]
        assert mine_tx.id not in [r['id'] for r in rows]

    def test_a_family_login_cannot_reach_the_admin_surface(self, api_client):
        """Guards against a family account reading the whole roster."""
        mine, _, _ = _family(self_guardian=True)
        api_client.force_authenticate(user=mine.user)
        assert api_client.get(reverse('admin-balances')).status_code == 403
        assert api_client.post(
            reverse('admin-set-password', args=[mine.user.pk]), {}, format='json'
        ).status_code == 403
