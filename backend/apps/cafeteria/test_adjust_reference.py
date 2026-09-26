"""
adjust_balance stamps its synthetic loyverse_receipt_id BEFORE the insert
(Data Ops Phase 1). The old code inserted '' and updated the row afterwards,
so two concurrent adjustments (any two students, two gunicorn workers) collided
on the blank unique value on Postgres. SQLite cannot interleave transactions,
so the test observes the insert itself through ``pre_save``: the reference must
already be present when the row is created, and no second save may follow.
"""

from decimal import Decimal

import pytest
from django.db import transaction
from django.db.models.signals import pre_save

from apps.accounts.factories import AdminFactory, StudentProfileFactory
from apps.cafeteria import services
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction

pytestmark = pytest.mark.django_db


@pytest.fixture
def saves():
    seen = []

    def capture(sender, instance, **kwargs):
        if instance.transaction_type == CafeteriaTransaction.TxType.ADJUSTMENT:
            seen.append((instance.pk, instance.loyverse_receipt_id))

    pre_save.connect(capture, sender=CafeteriaTransaction, dispatch_uid="test-adjust-ref")
    yield seen
    pre_save.disconnect(capture, sender=CafeteriaTransaction, dispatch_uid="test-adjust-ref")


def test_two_students_in_one_transaction_get_distinct_references_at_insert(saves):
    s1, s2 = StudentProfileFactory(loyverse_id=""), StudentProfileFactory(loyverse_id="")
    CafeteriaBalance.objects.create(student=s1, balance=Decimal("100"))
    CafeteriaBalance.objects.create(student=s2, balance=Decimal("100"))
    admin = AdminFactory()

    with transaction.atomic():
        services.adjust_balance(s1, Decimal("10"), "uno", admin=admin, notify=False, mirror=False)
        services.adjust_balance(s2, Decimal("20"), "dos", admin=admin, notify=False, mirror=False)

    # Exactly one save per adjustment, each an INSERT (pk None) carrying its reference.
    assert len(saves) == 2
    assert all(pk is None for pk, _ in saves)
    refs = [ref for _, ref in saves]
    assert all(ref.startswith("adjust-tx-") and len(ref) > len("adjust-tx-") for ref in refs)
    assert len(set(refs)) == 2
    stored = CafeteriaTransaction.objects.filter(
        transaction_type=CafeteriaTransaction.TxType.ADJUSTMENT,
    ).values_list("loyverse_receipt_id", flat=True)
    assert set(stored) == set(refs)


def test_same_student_twice_keeps_the_convention(saves):
    student = StudentProfileFactory(loyverse_id="")
    CafeteriaBalance.objects.create(student=student, balance=Decimal("50"))
    services.adjust_balance(student, Decimal("5"), "a", notify=False, mirror=False)
    services.adjust_balance(student, Decimal("-5"), "b", notify=False, mirror=False)
    refs = {ref for _, ref in saves}
    assert len(refs) == 2 and all(r.startswith("adjust-tx-") for r in refs)
    assert CafeteriaBalance.objects.get(student=student).balance == Decimal("50")
