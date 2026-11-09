"""
record_restore_drill — deploy/restore-db.sh reports the monthly drill here.

The drill proves the newest backup can actually be restored. From 2026-10-04 it
failed every month (a missing extension stopped the restore) and only a log file
on the host knew: a drill that fails in silence proves nothing. Now the script
reports every run; a failure emails the admins at once, the marker feeds the
console, and check_backup_fresh notices when the drill stops running at all.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import OpsStatus


class Command(BaseCommand):
    help = 'Record the outcome of the monthly restore drill (called by deploy/restore-db.sh).'

    def add_arguments(self, parser):
        g = parser.add_mutually_exclusive_group(required=True)
        g.add_argument('--ok', action='store_true')
        g.add_argument('--failed', action='store_true')
        parser.add_argument('--dump', default='', help='File name of the dump that was restored.')
        parser.add_argument('--detail', default='', help='Counts on success, the reason on failure.')
        parser.add_argument('--no-email', action='store_true')

    def handle(self, *args, **o):
        ok = bool(o['ok'])
        OpsStatus.set('restore_drill', {
            'at': timezone.now().isoformat(),
            'ok': ok,
            'dump': o['dump'],
            'detail': o['detail'][:500],
        })
        self.stdout.write(f"restore drill recorded: {'ok' if ok else 'FAILED'} {o['dump']}".rstrip())
        if ok or o['no_email']:
            return

        from apps.accounts.models import User
        from apps.portal.services import send_email

        recipients = list(User.objects.filter(role=User.Role.ADMIN, is_active=True)
                          .exclude(email='').values_list('email', flat=True))
        if not recipients:
            self.stderr.write('no active admin to email')
            return
        sent = send_email(
            'Interlaken: la prueba mensual del respaldo falló',
            'La prueba automática que restaura el respaldo más reciente en una copia de '
            f"prueba no terminó bien ({o['dump'] or 'respaldo desconocido'}). "
            + (f"Detalle: {o['detail'][:300]}. " if o['detail'] else '')
            + 'Los respaldos se siguen generando, pero no está comprobado que se puedan '
            'restaurar. Revise en el servidor /var/log/interlaken/restore-drill.log.',
            recipients,
        )
        self.stdout.write(f'alert email {"sent" if sent else "NOT sent"} to {len(recipients)} admin(s)')
