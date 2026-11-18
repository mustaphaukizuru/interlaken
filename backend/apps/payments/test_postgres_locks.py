"""Row locks that PostgreSQL accepts (regression, 2026-11-18).

PostgreSQL refuses ``FOR UPDATE`` on the nullable side of an outer join.
SQLite, which the test suite runs on, ignores row locks entirely, so CI never
saw it: every «Verificar en MultiCobros» was a 500 in production. The query is
compiled with the PostgreSQL compiler (no database connection needed).
"""
import re

from django.db.backends.postgresql.base import DatabaseWrapper

from apps.payments.views import checkout_for_verify


def _postgres_sql(qs) -> str:
    pg = DatabaseWrapper({
        'ENGINE': 'django.db.backends.postgresql', 'NAME': 'compile-only', 'USER': '', 'PASSWORD': '',
        'HOST': '', 'PORT': '', 'OPTIONS': {}, 'TIME_ZONE': None, 'CONN_MAX_AGE': 0,
        'CONN_HEALTH_CHECKS': False, 'AUTOCOMMIT': True, 'ATOMIC_REQUESTS': False, 'TEST': {},
    }, alias='postgres-compile-only')
    pg.get_autocommit = lambda: False  # as inside atomic(); compiling never connects
    sql, _params = qs.query.get_compiler(connection=pg).as_sql()
    return sql


def assert_postgres_can_lock(qs):
    """No row of an outer-joined (nullable) table may be in the lock set."""
    sql = _postgres_sql(qs)
    assert 'FOR UPDATE' in sql
    outer = {name for pair in re.findall(r'LEFT OUTER JOIN "(\w+)"(?: (\w+))?', sql) for name in pair if name}
    if not outer:
        return
    locked = re.search(r'FOR UPDATE OF (.+)$', sql)
    assert locked, f'FOR UPDATE locks every joined row, outer joins included:\n{sql}'
    assert not set(re.findall(r'"?(\w+)"?', locked.group(1))) & outer, sql


def test_verify_in_multicobros_lock_is_valid_on_postgres():
    assert_postgres_can_lock(checkout_for_verify(1))


def test_the_check_catches_the_production_bug():
    from apps.payments.models import BanorteCheckout

    bad = BanorteCheckout.objects.select_for_update().select_related('payment', 'verified_by').filter(payment_id=1)
    try:
        assert_postgres_can_lock(bad)
    except AssertionError:
        return
    raise AssertionError('the guard did not flag FOR UPDATE over a LEFT OUTER JOIN')
