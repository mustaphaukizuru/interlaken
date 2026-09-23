"""
check_wallet_drift — the daily "the ledgers do not agree" alarm.

Reads the roster-wide picture the last full mirror pass persisted
(``OpsStatus['wallet_audit']``) and emails every active admin when anything
in it needs a person: students whose local balance sits above Loyverse,
students whose Loyverse customer is gone, student-looking customers no
student is linked to, or wallet receipts parked without an owner. Runs at
07:35, before the cafetería opens, so a purchase in flight cannot show up as
drift. Silent when everything is zero.
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import OpsStatus


class Command(BaseCommand):
    help = 'Email admins when the cafetería ledger and Loyverse disagree for anyone.'

    def add_arguments(self, parser):
        parser.add_argument('--no-email', action='store_true')

    def handle(self, *args, **o):
        audit = OpsStatus.get('wallet_audit') or {}
        if not audit:
            self.stdout.write(self.style.WARNING('no wallet audit recorded yet (has the cron run?)'))
            return

        drifting = int(audit.get('drifting') or 0)
        stale = int(audit.get('stale_links') or 0)
        unlinked = int(audit.get('unlinked_students') or 0)
        parked = int(audit.get('unmatched_receipts') or 0)
        drift_total = Decimal(str(audit.get('drift_total') or 0))
        problems = []
        if drifting:
            problems.append(f'{drifting} alumno(s) con saldo local por encima de Loyverse '
                            f'(diferencia total ${drift_total.copy_abs():.2f})')
        if stale:
            problems.append(f'{stale} alumno(s) cuyo cliente ya no existe en Loyverse')
        if unlinked:
            problems.append(f'{unlinked} cliente(s) de Loyverse con matrícula de alumno sin vincular')
        if parked:
            problems.append(f'{parked} recibo(s) del monedero sin alumno asignado')

        OpsStatus.set('wallet_drift_check', {
            'at': timezone.now().isoformat(), 'problems': len(problems),
            'audit_at': audit.get('at'),
        })
        if not problems:
            self.stdout.write(f'wallet converged: {audit.get("compared")} compared, 0 issues')
            return

        self.stdout.write(self.style.ERROR('WALLET DRIFT: ' + '; '.join(problems)))
        if o['no_email']:
            return

        from apps.accounts.models import User
        from apps.portal.services import send_email

        recipients = list(User.objects.filter(role=User.Role.ADMIN, is_active=True)
                          .exclude(email='').values_list('email', flat=True))
        if not recipients:
            self.stderr.write('no active admin to email')
            return
        body = ('La revisión diaria de la cafetería encontró:\n\n'
                + '\n'.join(f'  - {p}' for p in problems)
                + '\n\nRevise Administración → Cafetería → Estado de la sincronización y la '
                  'pestaña Reconciliación. Los alumnos sin cliente en Loyverse aparecen en '
                  'Alumnos → Vincular Loyverse, donde puede darlos de baja.')
        sent = send_email('Interlaken: la cafetería tiene diferencias por revisar', body, recipients)
        self.stdout.write(f'alert email {"sent" if sent else "NOT sent"} to {len(recipients)} admin(s)')
