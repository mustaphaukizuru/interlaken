"""The "cron stopped" alarm can fire, and fires once per outage.

Replaces a crontab line that read the log file's mtime and piped to `mail`,
which the VPS does not have. Measures LoyverseSyncState.last_poll_at (when the
poll last RAN), not the receipt cursor, so a quiet weekend is not an outage.
"""
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.accounts.factories import AdminFactory
from apps.cafeteria.models import LoyverseSyncState
from apps.core.models import OpsStatus


def polled(minutes_ago):
    st = LoyverseSyncState.load()
    st.last_poll_at = timezone.now() - timedelta(minutes=minutes_ago)
    st.save(update_fields=['last_poll_at'])


def run(*args):
    out = StringIO()
    call_command('check_sync_fresh', *args, stdout=out, stderr=out)
    return out.getvalue()


@pytest.mark.django_db
class TestCheckSyncFresh:
    def test_recent_poll_is_quiet(self):
        polled(4)
        with patch('apps.portal.services.send_email') as send:
            out = run()
        assert 'sync fresh' in out
        send.assert_not_called()
        assert OpsStatus.get('sync_check')['stale'] is False

    def test_stalled_poll_emails_every_active_admin(self):
        polled(45)
        a1, a2 = AdminFactory(), AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            out = run()
        assert 'SYNC STALE' in out
        assert set(send.call_args.args[2]) == {a1.email, a2.email}
        assert 'se detuvo' in send.call_args.args[0]
        assert OpsStatus.get('sync_check')['alerted_at']

    def test_never_ran_counts_as_stalled(self):
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            out = run()
        assert 'never run' in out
        send.assert_called_once()

    def test_one_email_per_outage_not_one_every_half_hour(self):
        polled(45)
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            run()
            out = run()
        assert send.call_count == 1
        assert 'already alerted' in out

    def test_realerts_after_the_poll_came_back_and_died_again(self):
        polled(45)
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            run()                       # outage 1 → email
            polled(1)                   # cron recovered
            run()                       # fresh, quiet
            polled(60)                  # outage 2
            run()
        assert send.call_count == 2

    def test_no_email_flag_only_updates_the_marker(self):
        AdminFactory()
        with patch('apps.portal.services.send_email') as send:
            run('--no-email')
        send.assert_not_called()
        assert OpsStatus.get('sync_check')['stale'] is True
