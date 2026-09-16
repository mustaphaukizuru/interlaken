"""
check_backup_fresh — the morning alarm for the nightly database backup.

Replaces a crontab line that piped to `mail`, a binary the VPS does not have,
so the alarm could never fire: silence from a backup job looks exactly like
success, which is how a previous one failed for five nights. This one goes
through the app's own email pipeline (the same one comunicados use) and also
flips the marker the console reads, so it is visible even if email is down.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.core.models import OpsStatus

MAX_AGE_HOURS = 26   # nightly at 02:30, checked at 07:45: one missed night trips it


class Command(BaseCommand):
    help = 'Alert (email + console marker) when the last good backup is older than a day.'

    def add_arguments(self, parser):
        parser.add_argument('--max-age-hours', type=int, default=MAX_AGE_HOURS)
        parser.add_argument('--no-email', action='store_true')

    def handle(self, *args, **o):
        marker = OpsStatus.get('backup') or {}
        last_ok = parse_datetime(marker.get('at') or '') if marker.get('ok') else None
        age_h = (timezone.now() - last_ok).total_seconds() / 3600 if last_ok else None
        stale = age_h is None or age_h > o['max_age_hours']

        OpsStatus.set('backup_check', {
            'at': timezone.now().isoformat(),
            'stale': stale,
            'age_hours': round(age_h, 1) if age_h is not None else None,
        })

        if not stale:
            self.stdout.write(f'backup fresh: {age_h:.1f} h old')
            return

        detail = ('no successful backup has ever been recorded'
                  if age_h is None else f'last good backup is {age_h:.0f} h old')
        if marker and not marker.get('ok'):
            detail += f" and the last run FAILED ({marker.get('at', '?')})"
        self.stdout.write(self.style.ERROR(f'BACKUP STALE: {detail}'))

        if o['no_email']:
            return
        from apps.accounts.models import User
        from apps.portal.services import send_email

        recipients = list(User.objects.filter(role=User.Role.ADMIN, is_active=True)
                          .exclude(email='').values_list('email', flat=True))
        if not recipients:
            self.stderr.write('no active admin to email')
            return
        sent = send_email(
            'Interlaken: respaldo de base de datos atrasado',
            f'El respaldo nocturno de la base de datos no se ha completado: {detail}.\n\n'
            'Revise Administración → Cafetería → Estado de la sincronización, y en el servidor '
            '/var/log/interlaken/backup.log. Mientras tanto no existe una copia reciente de los datos.',
            recipients,
        )
        self.stdout.write(f'alert email {"sent" if sent else "NOT sent"} to {len(recipients)} admin(s)')
