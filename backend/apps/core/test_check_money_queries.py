"""
check_money_queries: the row-locked money querysets, run against the real
database after every deploy (deploy/deploy.sh).

On SQLite (the default suite) row locks are ignored, so these tests prove the
command's contract: every check builds and runs, a database error or a stale
check fails it with a non-zero exit, nothing is ever written, and each lock is
one PostgreSQL accepts (compiled with the PostgreSQL compiler, no server
needed). On the PostgreSQL CI job the same tests run the queries for real, and
the last two prove the command catches both production bug classes.
"""

import io

import pytest
from django.core.management import CommandError, call_command
from django.db import connection
from django.db.models import Count
from django.db.models.expressions import RawSQL

from apps.core import money_queries
from apps.core.bulk import AdminBulkView
from apps.core.money_queries import MISSING, LockedQuery, all_checks, bulk_views, run_checks
from apps.payments.test_postgres_locks import _postgres_sql, assert_postgres_can_lock

pytestmark = pytest.mark.django_db

on_postgres = pytest.mark.skipif(
    connection.vendor != "postgresql", reason="needs PostgreSQL (TEST_DATABASE_URL)"
)


def _run(*args):
    out, err = io.StringIO(), io.StringIO()
    call_command("check_money_queries", *args, stdout=out, stderr=err)
    return out.getvalue(), err.getvalue()


def _ok_check(name="good"):
    from apps.payments.models import Payment

    return LockedQuery(name, "test", lambda: Payment.objects.select_for_update().filter(pk=MISSING))


def test_every_money_query_runs_on_this_database():
    out, err = _run()
    assert "money queries OK" in out
    assert "rolled back, nothing written" in out
    assert err == ""


def test_verbose_lists_every_query():
    out, _ = _run("-v", "2")
    assert "Verificar en MultiCobros" in out
    assert "apps/payments/views.py checkout_for_verify" in out
    assert out.count("  ok    ") == len(all_checks())


def test_the_money_paths_are_covered():
    sources = " | ".join(c.source for c in all_checks())
    for expected in (
        "apps/payments/views.py checkout_for_verify",
        "apps/payments/views.py BanorteResultView.post",
        "apps/payments/settlement.py apply_event",
        "apps/payments/multicobros.py _locked",
        "apps/cafeteria/services.py complete_online_topup",
        "apply_paid_topup",
        "refund_paid_topup",
        "reverse_online_topup",
        "mirror_pos_topups",
        "add_points_to_customer",
        "apps/cafeteria/views.py AdminApplyTopUpView.post",
        # The two bulk lists whose lock failed (or would fail) on PostgreSQL.
        "apps/content/forms.py FormBulkView",
        "apps/cafeteria/admin_data.py AdminTopUpBulkView",
    ):
        assert expected in sources, expected


def test_every_routed_bulk_view_is_checked():
    def subclasses(cls):
        for sub in cls.__subclasses__():
            yield sub
            yield from subclasses(sub)

    found = set(bulk_views())
    assert len(found) >= 20
    # Every bulk view defined in the apps is routed, so none escapes the check.
    defined = {c for c in subclasses(AdminBulkView) if c.__module__.startswith("apps.")}
    defined = {c for c in defined if "test" not in c.__module__}
    assert defined <= found, defined - found


@pytest.mark.parametrize("check", all_checks(), ids=lambda c: c.source)
def test_each_lock_is_one_postgres_accepts(check):
    """Compiled with the PostgreSQL compiler: no outer-joined table in the lock
    set, no GROUP BY or DISTINCT under FOR UPDATE (the two production bugs)."""
    qs = check.build()
    assert_postgres_can_lock(qs)
    sql = _postgres_sql(qs)
    assert "GROUP BY" not in sql, sql
    assert "DISTINCT" not in sql, sql


def test_a_database_error_fails_the_command_and_the_rest_still_run(monkeypatch):
    from apps.payments.models import Payment

    broken = LockedQuery(
        "broken",
        "apps/somewhere.py broken_view",
        lambda: Payment.objects.annotate(x=RawSQL("no_such_column", [])).filter(pk=MISSING),
    )
    monkeypatch.setattr(money_queries, "all_checks", lambda: [broken, _ok_check("after")])

    out, err = io.StringIO(), io.StringIO()
    with pytest.raises(CommandError, match="1 of 2 money queries FAIL"):
        call_command("check_money_queries", "-v", "2", stdout=out, stderr=err)
    assert "FAIL  broken" in err.getvalue()
    assert "source: apps/somewhere.py broken_view" in err.getvalue()
    assert "no_such_column" in err.getvalue()
    # The failed savepoint is rolled back and the next query still runs.
    assert "ok    after" in out.getvalue()


def test_a_stale_check_is_a_failure_not_a_skip():
    from apps.payments.models import Payment

    stale = LockedQuery("stale", "test", lambda: Payment.objects.filter(renamed_field=1))
    [result] = run_checks([stale])
    assert not result.ok
    assert result.error.startswith("could not be built: FieldError")


def test_nothing_is_ever_written():
    from apps.accounts.models import User

    def writes_then_queries():
        User.objects.create_user(email="probe@test.mx", password="x-probe-123")
        return User.objects.select_for_update().filter(pk=MISSING)

    [result] = run_checks([LockedQuery("writer", "test", writes_then_queries)])
    assert result.ok
    assert not User.objects.filter(email="probe@test.mx").exists()


@on_postgres
def test_postgres_rejects_the_2026_11_18_lock():
    """The query «Verificar en MultiCobros» ran before PR #246."""
    from apps.payments.models import BanorteCheckout

    bad = LockedQuery(
        "outer join",
        "test",
        lambda: BanorteCheckout.objects.select_for_update()
        .select_related("payment", "verified_by")
        .filter(payment_id=MISSING)[:1],
    )
    [result] = run_checks([bad, _ok_check()])[:1]
    assert "nullable side of an outer join" in result.error


@on_postgres
def test_postgres_rejects_a_locked_group_by():
    """The forms bulk delete: a Count annotation under the bulk lock."""
    from apps.content.forms import FormDefinition

    bad = LockedQuery(
        "group by",
        "test",
        lambda: FormDefinition.objects.annotate(n=Count("submissions"))
        .filter(pk__in=[MISSING])
        .select_for_update(of=("self",)),
    )
    results = run_checks([bad, _ok_check()])
    assert "GROUP BY" in results[0].error
    assert results[1].ok
