"""
Financial history must survive a student delete (Tier0 #5). The wallet ledger,
balances, adjustments, top-ups and tuition invoices are on_delete=PROTECT, so
deleting a StudentProfile that has any of them raises ProtectedError instead of
silently cascading the records away.
"""
from decimal import Decimal

import pytest
from django.db.models import ProtectedError

from apps.accounts.factories import StudentProfileFactory
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

pytestmark = pytest.mark.django_db


def test_student_with_ledger_cannot_be_deleted():
    student = StudentProfileFactory()
    CafeteriaTransaction.objects.create(
        student=student,
        transaction_type=CafeteriaTransaction.TxType.PURCHASE,
        amount=Decimal("25.00"),
        loyverse_receipt_id="rcpt-protect-1",
    )
    with pytest.raises(ProtectedError):
        student.delete()


def test_student_with_balance_cannot_be_deleted():
    student = StudentProfileFactory()
    CafeteriaBalance.objects.create(student=student, balance=Decimal("100.00"))
    with pytest.raises(ProtectedError):
        student.delete()


def test_student_without_financial_records_still_deletes():
    # A brand-new student with no money trail can still be removed cleanly.
    student = StudentProfileFactory()
    student.delete()
