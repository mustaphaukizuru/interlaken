"""The "cron stopped" alarm can fire, and fires once per outage.

Replaces a crontab line that read the log file's mtime and piped to `mail`,
which the VPS does not have. Measures LoyverseSyncState.last_poll_at (when the
poll last RAN), not the receipt cursor, so a quiet weekend is not an outage.

Since 2026-09-24 it also watches the daily roster sync
(LoyverseSyncState.last_roster_sync_at): that job had never run in production
and nothing measured it.
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


def roster_synced(hours_ago):
    st = LoyverseSyncState.load()
    st.last_roster_sync_at = timezone.now() - timedelta(hours=hours_ago)
    st.save(update_fields=['last_roster_sync_at'])


def run(*args):
    out = StringIO()
    call_command('check_sync_fresh', *args, stdout=out, stderr=out)
    return out.getvalue()


@pytest.mark.django_db
class TestCheckSyncFresh:
    def test_recent_poll_is_quiet(self):
        polled(4)
        roster_synced(2)
        with patch('apps.portal.services.send_email') as send:
            out = run()
        assert 'sync fresh' in out and 'roster fresh' in out
        send.assert_not_called()
        assert OpsStatus.get('sync_check')['stale'] is False
        assert OpsStatus.get('sync_check')['roster_stale'] is False

    def test_stalled_poll_emails_every_active_admin(self):
        polled(45)
        roster_synced(2)
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
        roster_synced(2)
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            run()
            out = run()
        assert send.call_count == 1
        assert 'already alerted' in out

    def test_realerts_after_the_poll_came_back_and_died_again(self):
        polled(45)
        roster_synced(2)
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


@pytest.mark.django_db
class TestRosterAlarm:
    """The defect of 2026-09-24: sync_roster silently never ran, for months."""

    def test_roster_older_than_30h_alerts_with_the_office_message(self):
        polled(1)
        roster_synced(31)
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            out = run()
        assert 'ROSTER STALE' in out and 'sync fresh' in out
        subject, body = send.call_args.args[0], send.call_args.args[1]
        assert 'roster' in subject
        assert 'El roster no se ha sincronizado con Loyverse desde' in body
        assert 'Sincronizar roster ahora' in body
        marker = OpsStatus.get('sync_check')
        assert marker['roster_stale'] is True and marker['roster_alerted_at']
        assert marker['stale'] is False and marker['alerted_at'] is None

    def test_roster_never_synced_alerts_too(self):
        polled(1)
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            out = run()
        assert 'never run' in out
        assert 'nunca se ha sincronizado' in send.call_args.args[1]

    def test_roster_alert_is_once_per_outage_and_rearms_after_a_sync(self):
        polled(1)
        roster_synced(40)
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            run()                       # roster outage → one email
            out = run()                 # still stale, already alerted
            assert 'already alerted' in out
            roster_synced(1)            # the 06:07 job (or the button) ran
            run()                       # quiet, stamp cleared
            roster_synced(48)           # missed again
            run()
        assert send.call_count == 2
        assert OpsStatus.get('sync_check')['roster_age_hours'] == 48.0

    def test_both_stale_send_one_combined_email(self):
        polled(90)
        roster_synced(50)
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            run()
        assert send.call_count == 1
        body = send.call_args.args[1]
        assert 'no está corriendo' in body and 'El roster no se ha sincronizado' in body
        marker = OpsStatus.get('sync_check')
        assert marker['alerted_at'] and marker['roster_alerted_at']

    def test_threshold_is_configurable(self):
        polled(1)
        roster_synced(20)
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            assert 'roster fresh' in run()
            assert 'ROSTER STALE' in run('--max-roster-age-hours', '12')
        assert send.call_count == 1
