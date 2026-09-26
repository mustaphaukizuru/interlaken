from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import StudentProfile, User
from apps.admissions.models import PreRegistration
from apps.cafeteria.models import CafeteriaBalance, CafeteriaTransaction
from apps.core.models import AuditLog
from apps.payments.models import Payment

pytestmark = pytest.mark.django_db

TINY = {"students": 3, "transactions": 20, "audit": 30, "payments": 7, "preregistrations": 5}


def _counts():
    return (
        User.objects.filter(email__endswith="@perf.invalid").count(),
        StudentProfile.objects.count(),
        CafeteriaBalance.objects.count(),
        CafeteriaTransaction.objects.count(),
        AuditLog.objects.count(),
        Payment.objects.count(),
        PreRegistration.objects.count(),
    )


def test_seed_perf_data_counts_and_idempotence(settings):
    settings.DEBUG = True
    call_command("seed_perf_data", stdout=StringIO(), **TINY)
    # 3 students + 2 guardians (one per two students).
    assert _counts() == (5, 3, 3, 20, 30, 7, 5)
    assert set(StudentProfile.objects.values_list("loyverse_id", flat=True)) == {
        "perf-lv-00000",
        "perf-lv-00001",
        "perf-lv-00002",
    }
    assert PreRegistration.objects.values("status").distinct().count() >= 2

    call_command("seed_perf_data", stdout=StringIO(), **TINY)
    assert _counts() == (5, 3, 3, 20, 30, 7, 5)

    # Raising a target only tops up the difference.
    call_command("seed_perf_data", stdout=StringIO(), **{**TINY, "students": 4, "transactions": 25})
    assert _counts() == (6, 4, 4, 25, 30, 7, 5)


def test_seed_perf_data_refuses_without_debug(settings):
    settings.DEBUG = False
    with pytest.raises(CommandError, match="DEBUG=False"):
        call_command("seed_perf_data", stdout=StringIO(), **TINY)
    assert StudentProfile.objects.count() == 0
    call_command("seed_perf_data", force=True, stdout=StringIO(), **TINY)
    assert StudentProfile.objects.count() == 3
