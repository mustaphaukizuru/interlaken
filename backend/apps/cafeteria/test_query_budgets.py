"""P7 query budgets: family balance + admin deposits log stay O(1) in N.

Each test parametrizes small-N vs 3N and asserts the SAME pinned constant, so
any reintroduced per-row query (N+1) fails the budget instead of slipping by.
"""

from decimal import Decimal
from unittest.mock import patch

import pytest
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria.models import (
    BalanceAdjustment,
    CafeteriaBalance,
    CafeteriaTransaction,
    LoyverseProfile,
    TopUpRequest,
)
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

# students + bulk-create missing balances + balances (user joined) + spend map
# + paid top-ups waiting for their POS load (their folios only when there are any).
BALANCE_BUDGET = 5
# pagination count + page rows (student/POS users joined) + payments prefetch.
TOPUP_LOG_BUDGET = 3


class TestBalanceBudget:
    @pytest.mark.parametrize("n_children", [1, 3])
    def test_constant_queries_regardless_of_family_size(
        self, api_client, django_assert_num_queries, n_children
    ):
        parent = ParentFactory()
        for _ in range(n_children):
            student = StudentProfileFactory(parents=[parent])
            CafeteriaTransaction.objects.create(
                student=student,
                transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                amount=Decimal("25.00"),
                loyverse_receipt_id=f"p7-{student.pk}",
            )

        api_client.force_authenticate(parent)
        with django_assert_num_queries(BALANCE_BUDGET):
            resp = api_client.get(reverse("cafeteria-balance"))
        assert resp.status_code == 200
        assert len(resp.data) == n_children
        # Spend map still feeds the budget bars for every child. Compare as
        # Decimal: SQLite aggregates drop trailing zeros ('25' vs '25.00').
        assert all(Decimal(row["today_spend"]) == Decimal("25") for row in resp.data)
        assert all(Decimal(row["week_spend"]) == Decimal("25") for row in resp.data)


class TestTopUpLogBudget:
    @pytest.mark.parametrize("n_rows", [4, 12])
    def test_constant_queries_regardless_of_row_count(
        self, api_client, django_assert_num_queries, n_rows
    ):
        admin = AdminFactory()
        parent = ParentFactory()
        for _ in range(n_rows):
            student = StudentProfileFactory(parents=[parent])
            topup = TopUpRequest.objects.create(
                student=student,
                amount=Decimal("100.00"),
                method=TopUpRequest.Method.ONLINE,
                status=TopUpRequest.Status.COMPLETED,
            )
            Payment.objects.create(
                user=parent,
                payment_type=Payment.Type.CAFETERIA,
                amount=Decimal("100.00"),
                related_topup=topup,
                status=Payment.Status.SUCCESS,
            )

        api_client.force_authenticate(admin)
        with django_assert_num_queries(TOPUP_LOG_BUDGET):
            resp = api_client.get(reverse("admin-topups"))
        assert resp.status_code == 200
        assert resp.data["count"] == n_rows
        # The linked gateway payment must still be resolved (via the prefetch).
        assert all(row["payment_status"] == Payment.Status.SUCCESS for row in resp.data["results"])


# ── Data Ops Phase 10: the remaining admin lists and every admin export ───
# Loyverse is never reached: the live reads are patched on
# ``apps.cafeteria.services`` (and conftest blanks the token). Exports are
# consumed inside the assert block so the streamed rows and the audit insert
# are counted.
# pagination count + page rows (admin joined).
ADJUSTMENTS_BUDGET = 2
# pagination count + page rows (student/user/profile joined).
LOW_BALANCE_BUDGET = 2
# count + page + unmatched-receipt counts + summary per kind + missing count.
CUSTOMERS_BUDGET = 5
# count + page (user, profile and balance joined) + the three POS-queue reads
# (pending loads, pending unloads, paid top-ups to apply); the one store-wide
# Loyverse fetch is mocked.
RECONCILE_BUDGET = 5
# count + rows + audit insert (each export; top-ups add the payments prefetch).
BALANCES_EXPORT_BUDGET = 3
TRANSACTIONS_EXPORT_BUDGET = 3
TOPUPS_EXPORT_BUDGET = 4
LOW_BALANCE_EXPORT_BUDGET = 3
CUSTOMERS_EXPORT_BUDGET = 3
RECONCILE_EXPORT_BUDGET = 3
# student + balance get_or_create + ledger rows + the export audit row.
STUDENT_STATEMENT_BUDGET = 4
# family monthly PDF: student (user joined) + month rows + opening-balance row.
FAMILY_STATEMENT_BUDGET = 3


def _body(resp) -> bytes:
    return b"".join(resp.streaming_content) if resp.streaming else resp.content


def _csv_lines(resp) -> list[str]:
    return [line for line in _body(resp).decode("utf-8-sig").split("\r\n")[1:] if line]


def _wallets(n, balance="10.00", threshold="50.00"):
    """``n`` linked students with a wallet under threshold and a recent purchase."""
    parent = ParentFactory()
    students = []
    for i in range(n):
        student = StudentProfileFactory(parents=[parent])
        CafeteriaBalance.objects.create(
            student=student, balance=Decimal(balance), low_balance_threshold=Decimal(threshold)
        )
        CafeteriaTransaction.objects.create(
            student=student,
            transaction_type=CafeteriaTransaction.TxType.PURCHASE,
            amount=Decimal("5.00"),
            balance_after=Decimal(balance),
            loyverse_receipt_id=f"qb-{student.pk}",
        )
        LoyverseProfile.objects.create(
            loyverse_id=student.loyverse_id,
            student=student,
            name=f"Cliente {i}",
            kind=LoyverseProfile.Kind.STUDENT,
            customer_code=f"ci{student.student_id}",
        )
        students.append(student)
    return students


def _topups(n):
    parent = ParentFactory()
    for _ in range(n):
        student = StudentProfileFactory(parents=[parent])
        topup = TopUpRequest.objects.create(
            student=student,
            amount=Decimal("100.00"),
            method=TopUpRequest.Method.ONLINE,
            status=TopUpRequest.Status.COMPLETED,
        )
        Payment.objects.create(
            user=parent,
            payment_type=Payment.Type.CAFETERIA,
            amount=Decimal("100.00"),
            related_topup=topup,
            status=Payment.Status.SUCCESS,
        )


class TestCafeteriaAdminListBudgets:
    @pytest.mark.parametrize("n", [1, 12])
    def test_adjustments(self, api_client, django_assert_num_queries, n):
        admin = AdminFactory()
        for student in _wallets(n):
            BalanceAdjustment.objects.create(
                student=student, admin=admin, amount=Decimal("5.00"), reason="qb"
            )
        api_client.force_authenticate(admin)
        with django_assert_num_queries(ADJUSTMENTS_BUDGET):
            resp = api_client.get(reverse("admin-adjustments"))
        assert resp.status_code == 200
        assert resp.data["count"] == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_low_balance(self, api_client, django_assert_num_queries, n):
        _wallets(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(LOW_BALANCE_BUDGET):
            resp = api_client.get(reverse("admin-low-balance"))
        assert resp.status_code == 200
        assert resp.data["count"] == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_customers(self, api_client, django_assert_num_queries, n):
        _wallets(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(CUSTOMERS_BUDGET):
            resp = api_client.get(reverse("admin-customers"))
        assert resp.status_code == 200
        assert resp.data["count"] == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_reconcile(self, api_client, django_assert_num_queries, n):
        _wallets(n)
        api_client.force_authenticate(AdminFactory())
        from apps.accounts.models import StudentProfile

        store = [{"id": lid, "total_points": 10}
                 for lid in StudentProfile.objects.values_list("loyverse_id", flat=True)]
        with patch("apps.cafeteria.services.get_all_customers", return_value=store):
            with django_assert_num_queries(RECONCILE_BUDGET):
                resp = api_client.get(reverse("admin-reconcile"))
        assert resp.status_code == 200
        assert resp.data["checked"] == n
        assert all(row["in_sync"] for row in resp.data["results"])


class TestCafeteriaAdminExportBudgets:
    @pytest.mark.parametrize("n", [1, 12])
    def test_balances_export(self, api_client, django_assert_num_queries, n):
        _wallets(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(BALANCES_EXPORT_BUDGET):
            resp = api_client.get(reverse("admin-balances-export"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_transactions_export(self, api_client, django_assert_num_queries, n):
        _wallets(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(TRANSACTIONS_EXPORT_BUDGET):
            resp = api_client.get(reverse("admin-transactions-export"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_topups_export(self, api_client, django_assert_num_queries, n):
        _topups(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(TOPUPS_EXPORT_BUDGET):
            resp = api_client.get(reverse("admin-topups-export"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_low_balance_export(self, api_client, django_assert_num_queries, n):
        _wallets(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(LOW_BALANCE_EXPORT_BUDGET):
            resp = api_client.get(reverse("admin-low-balance-export"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_customers_export(self, api_client, django_assert_num_queries, n):
        _wallets(n)
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(CUSTOMERS_EXPORT_BUDGET):
            resp = api_client.get(reverse("admin-customers-export"))
            assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_reconcile_export(self, api_client, django_assert_num_queries, n):
        students = _wallets(n)
        store = [{"id": s.loyverse_id, "total_points": 10} for s in students]
        api_client.force_authenticate(AdminFactory())
        with patch("apps.cafeteria.services.get_all_customers", return_value=store):
            with django_assert_num_queries(RECONCILE_EXPORT_BUDGET):
                resp = api_client.get(reverse("admin-reconcile-export"))
                assert len(_csv_lines(resp)) == n

    @pytest.mark.parametrize("n", [1, 12])
    def test_student_statement(self, api_client, django_assert_num_queries, n):
        student = _wallets(1)[0]
        for i in range(n - 1):
            CafeteriaTransaction.objects.create(
                student=student,
                transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                amount=Decimal("1.00"),
                balance_after=Decimal("10.00"),
                loyverse_receipt_id=f"qb-extra-{i}",
            )
        api_client.force_authenticate(AdminFactory())
        with django_assert_num_queries(STUDENT_STATEMENT_BUDGET):
            resp = api_client.get(reverse("admin-export-student", args=[student.pk]))
            assert resp.status_code == 200
            # 7 header lines (title, alumno, matrícula, saldo, generado, blank, columns).
            assert _body(resp).count(b"\n") == n + 7

    @pytest.mark.parametrize("n", [1, 12])
    def test_family_statement_pdf(self, api_client, django_assert_num_queries, n):
        parent = ParentFactory()
        student = StudentProfileFactory(parents=[parent])
        for i in range(n):
            CafeteriaTransaction.objects.create(
                student=student,
                transaction_type=CafeteriaTransaction.TxType.PURCHASE,
                amount=Decimal("1.00"),
                balance_after=Decimal(str(100 - i)),
                loyverse_receipt_id=f"qb-month-{i}",
            )
        api_client.force_authenticate(parent)
        with django_assert_num_queries(FAMILY_STATEMENT_BUDGET):
            resp = api_client.get(reverse("cafeteria-statement"), {"student": student.pk})
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/pdf"
