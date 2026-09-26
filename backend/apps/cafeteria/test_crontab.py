"""deploy/crontab.example cannot schedule two jobs on one lock at the same minute.

The 2026-09-24 defect: ``sync_roster`` (06:05) and ``sync_purchases --since-days 7``
(05:40) shared ``/tmp/interlaken-loyverse.lock`` with the every-5-minutes poll,
both sat on the 5-minute grid, both used ``flock -n``. The poll won the race
every morning and the daily jobs exited silently; the roster job had never
run in production. This parses the example crontab the way cron does and
fails the build if that shape ever comes back.
"""
import re
from datetime import datetime, timedelta
from pathlib import Path

CRONTAB = Path(__file__).resolve().parents[3] / 'deploy' / 'crontab.example'
_LOCK_RE = re.compile(r'flock\s+(-\S+)(?:\s+(\d+))?\s+(/\S+\.lock)')


def _field_matches(spec, value, lo):
    for part in spec.split(','):
        step = 1
        if '/' in part:
            part, step = part.split('/', 1)
            step = int(step)
        if part == '*':
            if (value - lo) % step == 0:
                return True
            continue
        if '-' in part:
            a, b = (int(x) for x in part.split('-', 1))
        else:
            a = b = int(part)
        if a <= value <= b and (value - a) % step == 0:
            return True
    return False


def _fires_at(entry, when):
    minute, hour, dom, month, dow = entry['fields']
    if not (_field_matches(minute, when.minute, 0) and _field_matches(hour, when.hour, 0)
            and _field_matches(month, when.month, 1)):
        return False
    weekday = (when.weekday() + 1) % 7            # cron: 0 = Sunday
    dom_ok = _field_matches(dom, when.day, 1)
    dow_ok = _field_matches(dow.replace('7', '0'), weekday, 0)
    if dom != '*' and dow != '*':
        return dom_ok or dow_ok                    # cron ORs the two when both are set
    return dom_ok and dow_ok


def parse_crontab(text):
    entries = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or re.match(r'^[A-Z_]+=', line):
            continue
        fields = line.split(None, 5)
        if len(fields) < 6:
            continue
        m = _LOCK_RE.search(fields[5])
        entries.append({
            'fields': fields[:5], 'command': fields[5],
            'lock': m.group(3) if m else None,
            'flock_flag': m.group(1) if m else None,
            'flock_wait': m.group(2) if m else None,
            'daily': fields[0].isdigit() and fields[1].isdigit(),
        })
    return entries


def _collisions(entries):
    """Pairs of entries that share a lock file and can fire in the same minute
    somewhere in a full week (every field shape in the file is covered)."""
    start = datetime(2026, 9, 21, 0, 0)            # a Monday
    minutes = [start + timedelta(minutes=i) for i in range(7 * 24 * 60)]
    by_lock = {}
    for e in entries:
        if e['lock']:
            by_lock.setdefault(e['lock'], []).append(e)
    found = []
    for lock, group in by_lock.items():
        for i, a in enumerate(group):
            for b in group[i + 1:]:
                if any(_fires_at(a, t) and _fires_at(b, t) for t in minutes):
                    found.append((lock, ' '.join(a['fields']), ' '.join(b['fields'])))
    return found


def test_parser_reads_the_real_file():
    entries = parse_crontab(CRONTAB.read_text(encoding='utf-8'))
    assert len(entries) >= 10
    locked = [e for e in entries if e['lock']]
    assert any('sync_roster' in e['command'] for e in locked)
    assert any('sync_purchases --since-days 7' in e['command'] for e in locked)


def test_no_two_jobs_on_one_lock_can_fire_in_the_same_minute():
    entries = parse_crontab(CRONTAB.read_text(encoding='utf-8'))
    assert _collisions(entries) == []


def test_daily_jobs_on_a_shared_lock_wait_instead_of_giving_up():
    entries = parse_crontab(CRONTAB.read_text(encoding='utf-8'))
    shared = {lock for lock in (e['lock'] for e in entries if e['lock'])
              if sum(1 for e in entries if e['lock'] == lock) > 1}
    daily_on_shared = [e for e in entries if e['daily'] and e['lock'] in shared]
    assert daily_on_shared, 'the nightly Loyverse jobs must still share the poll lock'
    for e in daily_on_shared:
        assert e['flock_flag'] == '-w' and int(e['flock_wait'] or 0) >= 60, e['command']


def test_the_two_nightly_jobs_sit_off_the_five_minute_grid():
    """Even with ``-w`` a job on the grid would queue behind the poll every
    time; the spec pins 05:42 and 06:07."""
    entries = parse_crontab(CRONTAB.read_text(encoding='utf-8'))
    by_cmd = {('sync_roster' if 'sync_roster' in e['command'] else 'purchases7'): e['fields']
              for e in entries if 'sync_roster' in e['command']
              or 'sync_purchases --since-days 7' in e['command']}
    assert by_cmd['sync_roster'][:2] == ['7', '6']
    assert by_cmd['purchases7'][:2] == ['42', '5']


def test_the_detector_would_have_caught_the_old_crontab():
    """Regression guard for the guard: the pre-fix schedule must be rejected."""
    old = (
        "*/5 * * * * cd $C && flock -n /tmp/interlaken-loyverse.lock bash -c 'x' >> l 2>&1\n"
        "5 6 * * * cd $C && flock -n /tmp/interlaken-loyverse.lock docker x sync_roster >> l 2>&1\n"
    )
    entries = parse_crontab(old)
    assert _collisions(entries) == [('/tmp/interlaken-loyverse.lock', '*/5 * * * *', '5 6 * * *')]
    assert entries[1]['daily'] and entries[1]['flock_flag'] == '-n'
