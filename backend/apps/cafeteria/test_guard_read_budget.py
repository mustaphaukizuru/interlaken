"""The money guard's Loyverse read on a short, single-attempt budget (2026-11-19).

A bulk «Aplicar (ya cargadas en POS)» reads Loyverse once per row before it
credits. That read went through the retrying session (3 retries with backoff,
connect 5 s / read 15 s each: ~83 s per row when Loyverse hangs), so one
chunk of 5 rows could outlive gunicorn's 60 s worker. Now:

- ``loyverse_points_for_guard`` reads in ONE attempt on (3 s, 5 s) and falls
  back to the snapshot exactly as before; every other Loyverse read keeps the
  retrying (5 s, 15 s) session.
- The bulk checks its time budget before every row (``budget_per_row``) and
  reports the rest as NOT_REACHED for the dialog to continue.
- What the guard decides with the points (refuse a credit Loyverse cannot
  cover, ``force`` with a motive bypasses it) is unchanged.

Invented names and ids only.
"""
import threading
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch

import pytest
import requests
from django.urls import reverse

from apps.accounts.factories import AdminFactory, ParentFactory, StudentProfileFactory
from apps.cafeteria import admin_data, services
from apps.cafeteria.models import CafeteriaBalance, LoyverseProfile, TopUpRequest
from apps.cafeteria.services import (
    TopUpApplyError,
    apply_paid_topup,
    get_customer_by_id,
    loyverse_points_for_guard,
)
from apps.cafeteria.test_topup_scheduled_apply import paid_topup
from apps.core import bulk as bulk_mod
from apps.core.bulk import NOT_REACHED

pytestmark = pytest.mark.django_db

SESSION_GET = 'requests.Session.get'


@pytest.fixture
def loyverse(settings):
    settings.LOYVERSE_API_TOKEN = 'token-de-prueba'
    settings.LOYVERSE_BASE_URL = 'https://loyverse.invalid/v1.0'
    return settings


def _response(points):
    resp = requests.Response()
    resp.status_code = 200
    resp._content = f'{{"id": "lv-1", "total_points": {points}}}'.encode()
    return resp


def _snapshot(student, points, *, missing_since=None):
    return LoyverseProfile.objects.create(
        student=student, loyverse_id=student.loyverse_id, total_points=Decimal(points),
        missing_since=missing_since)


def _sent_with(get):
    """(session, timeout) of the one ``Session.get`` call."""
    call = get.call_args
    return call.args[0], call.kwargs['timeout']


class TestGuardRead:
    def test_one_attempt_on_the_short_timeout(self, loyverse):
        student = StudentProfileFactory(loyverse_id='lv-1')
        with patch(SESSION_GET, autospec=True, return_value=_response(120)) as get:
            assert loyverse_points_for_guard(student) == Decimal('120')
        session, timeout = _sent_with(get)
        assert get.call_count == 1
        assert timeout == services._GUARD_TIMEOUT == (3, 5)
        retry = session.get_adapter('https://loyverse.invalid').max_retries
        assert retry.total == 0 and not retry.status_forcelist

    def test_every_other_read_keeps_the_retrying_session(self, loyverse):
        with patch(SESSION_GET, autospec=True, return_value=_response(120)) as get:
            get_customer_by_id('lv-1')
        session, timeout = _sent_with(get)
        assert timeout == services._TIMEOUT == (5, 15)
        retry = session.get_adapter('https://loyverse.invalid').max_retries
        assert retry.total == 3 and 429 in retry.status_forcelist

    def test_the_budget_ends_with_the_guard_even_when_it_fails(self, loyverse):
        student = StudentProfileFactory(loyverse_id='lv-1')
        with patch(SESSION_GET, autospec=True, side_effect=requests.ReadTimeout('lenta')):
            loyverse_points_for_guard(student)
        assert services._READ_BUDGET.get() is None
        with patch(SESSION_GET, autospec=True, return_value=_response(1)) as get:
            get_customer_by_id('lv-1')
        assert _sent_with(get)[1] == (5, 15)

    def test_a_timeout_falls_back_to_the_snapshot(self, loyverse):
        student = StudentProfileFactory(loyverse_id='lv-1')
        _snapshot(student, '85.50')
        with patch(SESSION_GET, autospec=True, side_effect=requests.ReadTimeout('lenta')) as get:
            assert loyverse_points_for_guard(student) == Decimal('85.50')
        assert get.call_count == 1

    def test_a_timeout_with_the_card_gone_knows_nothing(self, loyverse):
        from django.utils import timezone

        student = StudentProfileFactory(loyverse_id='lv-1')
        _snapshot(student, '85.50', missing_since=timezone.now())
        with patch(SESSION_GET, autospec=True, side_effect=requests.ConnectTimeout('sin red')):
            assert loyverse_points_for_guard(student) is None


class _SlowLoyverse(BaseHTTPRequestHandler):
    """Answers every request late (or with a 503): counts the attempts."""

    hits = 0
    delay = 0.0
    status = 200

    def do_GET(self):  # noqa: N802 - http.server naming
        type(self).hits += 1
        threading.Event().wait(self.delay)
        body = b'{"id": "lv-1", "total_points": 300}'
        try:
            self.send_response(self.status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:  # the client gave up first
            pass

    def log_message(self, *args):
        pass


@pytest.fixture
def slow_loyverse(settings, monkeypatch):
    _SlowLoyverse.hits, _SlowLoyverse.delay, _SlowLoyverse.status = 0, 0.0, 200
    server = ThreadingHTTPServer(('127.0.0.1', 0), _SlowLoyverse)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    settings.LOYVERSE_API_TOKEN = 'token-de-prueba'
    settings.LOYVERSE_BASE_URL = f'http://127.0.0.1:{server.server_address[1]}/v1.0'
    # Same shape, test-sized: one attempt, give up reading after 0.3 s.
    monkeypatch.setattr(services, '_GUARD_TIMEOUT', (2, 0.3))
    yield _SlowLoyverse
    server.shutdown()
    server.server_close()


class TestAgainstASlowServer:
    """Real sockets: what one attempt means on the wire."""

    def test_a_hung_read_is_tried_once_then_the_snapshot_answers(self, slow_loyverse):
        slow_loyverse.delay = 1.5
        student = StudentProfileFactory(loyverse_id='lv-1')
        _snapshot(student, '40')
        assert loyverse_points_for_guard(student) == Decimal('40')
        assert slow_loyverse.hits == 1

    def test_a_503_is_not_retried(self, slow_loyverse):
        slow_loyverse.status = 503
        student = StudentProfileFactory(loyverse_id='lv-1')
        _snapshot(student, '40')
        assert loyverse_points_for_guard(student) == Decimal('40')
        assert slow_loyverse.hits == 1

    def test_a_healthy_answer_is_still_the_live_figure(self, slow_loyverse):
        student = StudentProfileFactory(loyverse_id='lv-1')
        _snapshot(student, '40')
        assert loyverse_points_for_guard(student) == Decimal('300')
        assert slow_loyverse.hits == 1


class TestMoneyRuleUnchanged:
    def test_unknown_points_still_refuse_the_credit(self, loyverse):
        student, topup, _ = paid_topup('100.00', balance=0)
        with patch(SESSION_GET, autospec=True, side_effect=requests.ReadTimeout('lenta')), \
                pytest.raises(TopUpApplyError) as err:
            apply_paid_topup(topup, actor=AdminFactory())
        assert err.value.code == 'pos_unknown'
        topup.refresh_from_db()
        assert topup.status == TopUpRequest.Status.PAID
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('0')

    def test_a_snapshot_that_does_not_show_the_load_still_refuses(self, loyverse):
        student, topup, _ = paid_topup('100.00', balance=0)
        _snapshot(student, '30')
        with patch(SESSION_GET, autospec=True, side_effect=requests.ReadTimeout('lenta')), \
                pytest.raises(TopUpApplyError) as err:
            apply_paid_topup(topup, actor=AdminFactory())
        assert err.value.code == 'pos_not_loaded'
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('0')

    def test_force_with_a_motive_never_reads_loyverse(self, loyverse):
        student, topup, _ = paid_topup('100.00', balance=0)
        with patch(SESSION_GET, autospec=True) as get:
            apply_paid_topup(topup, actor=AdminFactory(), force=True, note='Ya cargada en caja')
        assert get.call_count == 0
        assert CafeteriaBalance.objects.get(student=student).balance == Decimal('100')


class _Clock:
    """A fake ``time.monotonic`` for the bulk engine: each Loyverse read costs ``step``."""

    def __init__(self, step):
        self.now, self.step = 0.0, step

    def monotonic(self):
        return self.now

    def read(self, student):
        self.now += self.step
        return Decimal('1000')


class TestBulkApplyStopsAtTheBudget:
    def _topups(self, n):
        rows = []
        for i in range(n):
            parent = ParentFactory()
            student = StudentProfileFactory(parents=[parent], loyverse_id=f'lv-{i}')
            rows.append(paid_topup('10.00', student=student, parent=parent, balance=0)[1])
        return rows

    def test_slow_rows_stop_part_way_through_a_chunk(self, api_client, monkeypatch):
        assert admin_data.APPLY_PAID_CHUNK == 5 and admin_data.APPLY_PAID_BUDGET_SECONDS == 20
        clock = _Clock(step=9)          # each row's Loyverse read takes 9 s
        monkeypatch.setattr(bulk_mod, 'time', SimpleNamespace(monotonic=clock.monotonic))
        topups = self._topups(7)
        api_client.force_authenticate(user=AdminFactory())

        with patch('apps.cafeteria.services.loyverse_points_for_guard', side_effect=clock.read):
            r = api_client.post(reverse('admin-topups-bulk'),
                                {'action': 'apply_paid', 'ids': [t.pk for t in topups]},
                                format='json')

        assert r.status_code == 200, r.data
        # Rows start at 0, 9 and 18 s; at 27 s the budget (20 s) is spent, in
        # the middle of the first chunk of 5: the request ends one row later.
        assert r.data['ok'] == 3 and clock.now == 27
        later = [t.pk for t in topups[3:]]
        assert r.data['not_reached'] == 4 and r.data['not_reached_ids'] == later
        assert [f['id'] for f in r.data['failed']] == later
        assert {f['error'] for f in r.data['failed']} == {NOT_REACHED}
        assert r.data['total'] == '30.00'
        statuses = dict(TopUpRequest.objects.filter(pk__in=[t.pk for t in topups])
                        .values_list('pk', 'status'))
        assert [statuses[t.pk] for t in topups] == ['completed'] * 3 + ['paid'] * 4

    def test_continuing_the_rows_not_reached_finishes_the_job(self, api_client, monkeypatch):
        clock = _Clock(step=9)
        monkeypatch.setattr(bulk_mod, 'time', SimpleNamespace(monotonic=clock.monotonic))
        topups = self._topups(4)
        api_client.force_authenticate(user=AdminFactory())
        url = reverse('admin-topups-bulk')

        with patch('apps.cafeteria.services.loyverse_points_for_guard', side_effect=clock.read):
            first = api_client.post(url, {'action': 'apply_paid', 'ids': [t.pk for t in topups]},
                                    format='json')
            clock.now = 0
            second = api_client.post(url, {'action': 'apply_paid',
                                           'ids': first.data['not_reached_ids']}, format='json')

        assert first.data['ok'] == 3 and second.data['ok'] == 1
        assert 'not_reached' not in second.data and second.data['failed'] == []
        assert not TopUpRequest.objects.filter(status=TopUpRequest.Status.PAID).exists()
