"""
check_wallet_drift — the daily "the ledgers do not agree" alarm.

Reads the roster-wide picture the last full mirror pass persisted
(``OpsStatus['wallet_audit']``) and emails every active admin when anything
in it needs a person: students whose local balance sits above Loyverse,
students whose Loyverse customer is gone, student-looking customers no
student is linked to, or wallet receipts parked without an owner. Runs at
07:35, before the cafetería opens, so a purchase in flight cannot show up as
drift. Silent when everything is zero.

Receipts of staff and test cards are parked too and never resolve; they are
not a problem (until 2026-10-29 they made this email go out every morning).
An unchanged list of problems is emailed once and then weekly
(``apps.payments.ops_alerts``), so a daily copy of the same email does not
teach the office to ignore the one that matters.
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import OpsStatus
from apps.payments import ops_alerts

ALERT_KEY = 'wallet_drift_alert'


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
        # An audit written before the split has only the total.
        parked = int(audit.get('unmatched_receipts_student', audit.get('unmatched_receipts')) or 0)
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
        held = int(audit.get('held_paid') or 0)
        if held:
            problems.append(f'{held} alumno(s) con más saldo en Loyverse que en la app y una '
                            f'recarga en línea por aplicar que no coincide con esa diferencia '
                            f'(revise POS Loyverse → Por aplicar)')

        OpsStatus.set('wallet_drift_check', {
            'at': timezone.now().isoformat(), 'problems': len(problems),
            'audit_at': audit.get('at'),
        })
        if not problems:
            ops_alerts.clear_alert(ALERT_KEY)
            self.stdout.write(f'wallet converged: {audit.get("compared")} compared, 0 issues')
            return

        self.stdout.write(self.style.ERROR('WALLET DRIFT: ' + '; '.join(problems)))
        if o['no_email']:
            return
        fingerprint = '; '.join(problems)
        if not ops_alerts.should_alert(ALERT_KEY, fingerprint):
            self.stdout.write('same problems as the last email; not repeated before a week')
            return

        body = ('La revisión diaria de la cafetería encontró:\n\n'
                + '\n'.join(f'  - {p}' for p in problems)
                + '\n\nRevise Administración → Cafetería → Estado de la sincronización y la '
                  'pestaña Reconciliación. Los alumnos sin cliente en Loyverse aparecen en '
                  'Alumnos → Vincular Loyverse, donde puede darlos de baja.\n\n'
                  'Mientras la lista no cambie, este aviso se repite una vez por semana.')
        sent = ops_alerts.email_admins('Interlaken: la cafetería tiene diferencias por revisar', body)
        if not sent:
            self.stderr.write('alert email NOT sent (no active admin, or the send failed)')
            return
        ops_alerts.mark_alerted(ALERT_KEY, fingerprint)
        self.stdout.write(f'alert email sent to {sent} admin(s)')
