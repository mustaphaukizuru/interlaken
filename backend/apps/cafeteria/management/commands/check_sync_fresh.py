"""
check_sync_fresh — the alarm for "the cafetería cron stopped running".

Replaces a crontab line that inferred this from the log file's mtime and piped
the alert to `mail`, a binary the VPS does not have, so it could never fire.
Without an alarm a broken sync is invisible for days: the site looks fine and
balances just quietly stop moving.

Two independent checks, each with its own once-per-outage email stamp:

* the purchase poll, measured on its own "last ran" stamp
  (LoyverseSyncState.last_poll_at), not the receipt cursor: the cursor
  legitimately stands still over a weekend or a holiday, the poll does not;
* the daily roster sync (LoyverseSyncState.last_roster_sync_at), which until
  2026-09-24 had never run in production — it shared a lock file with the
  5-minute poll, lost the race every morning and exited silently — and no
  alarm measured it. More than 30 h without a written run means a missed
  morning.

Goes through the app's own email pipeline and sets the marker the console's
sync-health panel reads.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.cafeteria.models import LoyverseSyncState
from apps.core.models import OpsStatus

MAX_AGE_MINUTES = 30        # the cron runs every 5; six missed ticks is not jitter
MAX_ROSTER_AGE_HOURS = 30   # daily at 06:07; a day plus slack for a late night


def _local(dt):
    return timezone.localtime(dt).strftime('%d/%m/%Y %H:%M')


class Command(BaseCommand):
    help = 'Alert (email + console marker) when the purchase poll or the roster sync is stale.'

    def add_arguments(self, parser):
        parser.add_argument('--max-age-minutes', type=int, default=MAX_AGE_MINUTES)
        parser.add_argument('--max-roster-age-hours', type=int, default=MAX_ROSTER_AGE_HOURS)
        parser.add_argument('--no-email', action='store_true')

    def handle(self, *args, **o):
        now = timezone.now()
        state = LoyverseSyncState.objects.filter(pk=1).first()

        last = state.last_poll_at if state else None
        age_min = (now - last).total_seconds() / 60 if last else None
        stale = age_min is None or age_min > o['max_age_minutes']

        roster_last = state.last_roster_sync_at if state else None
        roster_age_h = (now - roster_last).total_seconds() / 3600 if roster_last else None
        roster_stale = roster_age_h is None or roster_age_h > o['max_roster_age_hours']

        previous = OpsStatus.get('sync_check') or {}
        # One email per outage: each alert stamp lives until its check is seen
        # healthy again, then clears so the next outage alerts afresh.
        alerted_at = previous.get('alerted_at') if stale else None
        roster_alerted_at = previous.get('roster_alerted_at') if roster_stale else None
        OpsStatus.set('sync_check', {
            'at': now.isoformat(),
            'stale': stale,
            'age_minutes': round(age_min, 1) if age_min is not None else None,
            'alerted_at': alerted_at,
            'roster_stale': roster_stale,
            'roster_age_hours': round(roster_age_h, 1) if roster_age_h is not None else None,
            'roster_alerted_at': roster_alerted_at,
        })

        if not stale:
            self.stdout.write(f'sync fresh: last poll {age_min:.1f} min ago')
        if not roster_stale:
            self.stdout.write(f'roster fresh: last sync {roster_age_h:.1f} h ago')
        if not stale and not roster_stale:
            return

        # (stamp key, English detail for the log, es-MX line for the email)
        problems = []
        if stale:
            detail = ('the purchase poll has never run'
                      if age_min is None else f'the purchase poll last ran {age_min:.0f} min ago')
            self.stdout.write(self.style.ERROR(f'SYNC STALE: {detail}'))
            if not alerted_at:
                problems.append(('alerted_at', (
                    'La sincronización automática con Loyverse no está corriendo: '
                    f'{detail}. Mientras tanto los saldos solo cambian cuando alguien '
                    'presiona Sincronizar.')))
        if roster_stale:
            rdetail = ('the roster sync has never run' if roster_age_h is None
                       else f'the roster last synced {roster_age_h:.0f} h ago')
            self.stdout.write(self.style.ERROR(f'ROSTER STALE: {rdetail}'))
            if not roster_alerted_at:
                since = _local(roster_last) if roster_last else None
                problems.append(('roster_alerted_at', (
                    (f'El roster no se ha sincronizado con Loyverse desde {since}.' if since
                     else 'El roster nunca se ha sincronizado con Loyverse.')
                    + ' Los cambios que la oficina hace en Loyverse (grado, nombre, código) no '
                    'llegan a la app hasta que corra. Debe correr cada madrugada a las 06:07 '
                    '(sync_roster); puede ejecutarlo ahora con el botón Sincronizar roster '
                    'ahora en Administración → Cafetería → Estado de la sincronización.')))
        if o['no_email']:
            return
        if not problems:
            self.stdout.write('already alerted for this outage')
            return

        from apps.accounts.models import User
        from apps.portal.services import send_email

        recipients = list(User.objects.filter(role=User.Role.ADMIN, is_active=True)
                          .exclude(email='').values_list('email', flat=True))
        if not recipients:
            self.stderr.write('no active admin to email')
            return
        subject = ('Interlaken: la sincronización de cafetería se detuvo'
                   if any(k == 'alerted_at' for k, _ in problems)
                   else 'Interlaken: el roster no se ha sincronizado con Loyverse')
        body = '\n\n'.join(line for _, line in problems) + (
            '\n\nRevise Administración → Cafetería → Estado de la sincronización, y en el '
            'servidor `crontab -l` y /var/log/interlaken/loyverse.log.')
        sent = send_email(subject, body, recipients)
        if sent:
            stamp = timezone.now().isoformat()
            OpsStatus.set('sync_check', {**(OpsStatus.get('sync_check') or {}),
                                         **{key: stamp for key, _ in problems}})
        self.stdout.write(f'alert email {"sent" if sent else "NOT sent"} to {len(recipients)} admin(s)')
