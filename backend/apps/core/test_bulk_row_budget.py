"""The bulk time budget checked before every row (``budget_per_row``, 2026-11-19).

A chunk is one transaction; the budget used to be checked between chunks only,
so a chunk of rows that each wait on an outside service (the Loyverse read of
«Aplicar (ya cargadas en POS)») could outlive gunicorn's 60 s worker by itself.
An action that sets ``budget_per_row`` now stops part way through the chunk:
the rows done so far commit with it (and their side effects run), the rest come
back as NOT_REACHED with their ids in ``not_reached_ids``. Every other action
keeps checking between chunks only. Invented data only.
"""

from types import SimpleNamespace

import pytest

from apps.accounts.factories import AdminFactory
from apps.admissions.models import PreRegistration
from apps.core import bulk as bulk_mod
from apps.core.bulk import NOT_REACHED, BulkAction, after_commit, run_bulk
from apps.core.models import AuditLog

pytestmark = pytest.mark.django_db


def _pre(n):
    return PreRegistration.objects.create(
        child_first_name=f"Niña{n}",
        child_last_name="Prueba",
        child_dob="2019-01-01",
        level=PreRegistration.Level.PRIMARY,
        grade_applying="Primaria 1°",
        parent_name="Tutora Prueba",
        parent_email=f"tutora{n}@test.mx",
        parent_phone="5550000000",
    )


@pytest.fixture
def clock(monkeypatch):
    """The engine's clock, moved by hand: a slow row advances it."""
    state = SimpleNamespace(now=0.0)
    monkeypatch.setattr(bulk_mod, "time", SimpleNamespace(monotonic=lambda: state.now))
    return state


def _slow_action(clock, done, sent, *, seconds=9, **options):
    def handler(instance, payload, actor):
        clock.now += seconds
        done.append(instance.pk)
        after_commit(lambda: sent.append(instance.pk))

    return BulkAction(name="lento", label_es="Lento", handler=handler, **options)


def _run(rows, action, **kwargs):
    return run_bulk(
        PreRegistration.objects.all(),
        [r.pk for r in rows],
        action,
        {},
        AdminFactory(),
        entity="admissions.preregistration",
        **kwargs,
    )


class TestBudgetPerRow:
    def test_a_slow_chunk_stops_at_the_budget_and_reports_the_rest(self, clock):
        rows = [_pre(i) for i in range(7)]
        done, sent = [], []
        action = _slow_action(clock, done, sent, chunk=5, time_budget=20, budget_per_row=True)

        result = _run(rows, action)

        # Rows start at 0, 9 and 18 s; at 27 s the 20 s budget is spent part
        # way through the first chunk of 5.
        assert result["ok"] == 3 and done == [r.pk for r in rows[:3]]
        later = [r.pk for r in rows[3:]]
        assert result["not_reached"] == 4 and result["not_reached_ids"] == later
        assert [f["id"] for f in result["failed"]] == later
        assert {f["error"] for f in result["failed"]} == {NOT_REACHED}
        # What ran is committed with its chunk: audited, side effects sent.
        assert sent == done
        audited = AuditLog.objects.filter(context="bulk:admissions.preregistration:lento")
        assert sorted(int(a.object_id) for a in audited) == sorted(done)

    def test_without_it_a_chunk_still_runs_to_its_end(self, clock):
        rows = [_pre(i) for i in range(7)]
        done, sent = [], []
        action = _slow_action(clock, done, sent, chunk=5, time_budget=20)

        result = _run(rows, action)

        # Unchanged for every other action: the whole first chunk (45 s), then stop.
        assert result["ok"] == 5 and clock.now == 45
        assert result["not_reached"] == 2
        assert result["not_reached_ids"] == [r.pk for r in rows[5:]]

    def test_the_first_row_always_runs(self, clock):
        rows = [_pre(i) for i in range(3)]
        done, sent = [], []
        action = _slow_action(clock, done, sent, chunk=5, time_budget=-1, budget_per_row=True)

        result = _run(rows, action)

        assert result["ok"] == 1 and result["not_reached"] == 2

    def test_failures_before_the_stop_keep_their_own_message(self, clock):
        rows = [_pre(i) for i in range(4)]

        def handler(instance, payload, actor):
            clock.now += 15
            if instance.pk == rows[0].pk:
                raise ValueError("Loyverse aún no muestra esta recarga.")

        action = BulkAction(
            name="lento",
            label_es="Lento",
            handler=handler,
            chunk=5,
            time_budget=20,
            budget_per_row=True,
        )
        result = _run(rows, action)

        assert result["ok"] == 1
        assert result["failed"][0] == {
            "id": rows[0].pk,
            "error": "Loyverse aún no muestra esta recarga.",
        }
        assert result["not_reached_ids"] == [r.pk for r in rows[2:]]

    def test_a_dry_run_has_no_budget(self, clock):
        rows = [_pre(i) for i in range(4)]

        def plan(instance, payload):
            clock.now += 50

        action = BulkAction(
            name="lento",
            label_es="Lento",
            handler=lambda *a: None,
            plan=plan,
            chunk=5,
            time_budget=1,
            budget_per_row=True,
        )
        result = _run(rows, action, dry_run=True)

        assert result["ok"] == 4 and "not_reached" not in result

    def test_a_finished_run_has_no_not_reached_keys(self, clock):
        rows = [_pre(i) for i in range(3)]
        action = _slow_action(
            clock, [], [], seconds=1, chunk=5, time_budget=20, budget_per_row=True
        )

        result = _run(rows, action)

        assert result["ok"] == 3 and result["failed"] == []
        assert "not_reached" not in result and "not_reached_ids" not in result
