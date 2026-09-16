"""
check_sync_fresh — the alarm for "the cafetería cron stopped running".

Replaces a crontab line that inferred this from the log file's mtime and piped
the alert to `mail`, a binary the VPS does not have, so it could never fire.
Without an alarm a broken sync is invisible for days: the site looks fine and
balances just quietly stop moving.

Measures the poll's own "last ran" stamp (LoyverseSyncState.last_poll_at), not
the receipt cursor: the cursor legitimately stands still over a weekend or a
holiday, the poll does not. Goes through the app's own email pipeline and sets
the marker the console's sync-health panel reads.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.cafeteria.models import LoyverseSyncState
from apps.core.models import OpsStatus

MAX_AGE_MINUTES = 30   # the cron runs every 5; six missed ticks is not jitter


class Command(BaseCommand):
    help = 'Alert (email + console marker) when the purchase poll has not run in a while.'

    def add_arguments(self, parser):
        parser.add_argument('--max-age-minutes', type=int, default=MAX_AGE_MINUTES)
        parser.add_argument('--no-email', action='store_true')

    def handle(self, *args, **o):
        state = LoyverseSyncState.objects.filter(pk=1).first()
        last = state.last_poll_at if state else None
        age_min = (timezone.now() - last).total_seconds() / 60 if last else None
        stale = age_min is None or age_min > o['max_age_minutes']

        previous = OpsStatus.get('sync_check') or {}
        # One email per outage: the alert stamp lives until the poll is seen
        # healthy again, then clears so the next outage alerts afresh.
        alerted_at = previous.get('alerted_at') if stale else None
        OpsStatus.set('sync_check', {
            'at': timezone.now().isoformat(),
            'stale': stale,
            'age_minutes': round(age_min, 1) if age_min is not None else None,
            'alerted_at': alerted_at,
        })

        if not stale:
            self.stdout.write(f'sync fresh: last poll {age_min:.1f} min ago')
            return

        detail = ('the purchase poll has never run'
                  if age_min is None else f'the purchase poll last ran {age_min:.0f} min ago')
        self.stdout.write(self.style.ERROR(f'SYNC STALE: {detail}'))
        if o['no_email']:
            return

        if alerted_at:
            self.stdout.write('already alerted for this outage')
            return

        from apps.accounts.models import User
        from apps.portal.services import send_email

        recipients = list(User.objects.filter(role=User.Role.ADMIN, is_active=True)
                          .exclude(email='').values_list('email', flat=True))
        if not recipients:
            self.stderr.write('no active admin to email')
            return
        sent = send_email(
            'Interlaken: la sincronización de cafetería se detuvo',
            f'La sincronización automática con Loyverse no está corriendo: {detail}.\n\n'
            'Mientras tanto los saldos solo cambian cuando alguien presiona Sincronizar. '
            'Revise Administración → Cafetería → Estado de la sincronización, y en el servidor '
            '`crontab -l` y /var/log/interlaken/loyverse.log.',
            recipients,
        )
        if sent:
            OpsStatus.set('sync_check', {**(OpsStatus.get('sync_check') or {}),
                                         'alerted_at': timezone.now().isoformat()})
        self.stdout.write(f'alert email {"sent" if sent else "NOT sent"} to {len(recipients)} admin(s)')
