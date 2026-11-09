"""
topup_apply_report — the paid online top-ups staff must load into the POS.

With ``CAFETERIA_TOPUP_APPLY_MODE='scheduled'`` a card top-up reaches the
wallet only after staff type it into the Loyverse POS (every school day at
``CAFETERIA_TOPUP_APPLY_TIME``, 07:30). This lists every paid top-up due by
the next hour, oldest first, with what staff need at the POS: student,
Loyverse customer code, amount and folio. Each one marked VENCIDA is past its
promised time: the family was told it would be applied by then.

Delivered to every active admin and to staff with the cafetería area, as an
in-app notification (always) and by email. Runs at 07:05 and hourly during the school day (deploy/crontab.example);
it only notifies when the list changed since the last notice, plus a
reminder every few hours while something is overdue. ``--no-email`` prints.

    python manage.py topup_apply_report [--no-email]
"""

from datetime import datetime, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import OpsStatus

STATE_KEY = 'topup_apply_report'
# Due this soon counts as "load it in the next batch".
LOOKAHEAD = timedelta(minutes=60)
# Past its promised time by this much: overdue.
GRACE = timedelta(minutes=30)
# An unchanged overdue list is re-sent at most this often.
REMIND_EVERY = timedelta(hours=3)


def _should_notify(fingerprint: str, overdue: bool, now) -> bool:
    state = OpsStatus.get(STATE_KEY) or {}
    if state.get('fingerprint') != fingerprint:
        return True
    if not overdue:
        return False
    try:
        sent = datetime.fromisoformat(state.get('alerted_at') or '')
    except ValueError:
        return True
    return now - sent >= REMIND_EVERY


class Command(BaseCommand):
    help = 'Notify admins of the paid online top-ups to load into the POS and apply.'

    def add_arguments(self, parser):
        parser.add_argument('--no-email', action='store_true')

    def handle(self, *args, no_email=False, **options):
        from apps.cafeteria.schedule import format_amount
        from apps.cafeteria.services import paid_topups_pending
        from apps.payments.models import Payment

        now = timezone.now()
        topups = list(paid_topups_pending()
                      .filter(apply_due_at__lte=now + LOOKAHEAD)
                      .select_related('student__user', 'student__loyverse_profile')
                      .order_by('apply_due_at', 'processed_at', 'pk'))
        if not topups:
            if not no_email and OpsStatus.get(STATE_KEY):
                OpsStatus.set(STATE_KEY, {})
            self.stdout.write('topups: nothing to apply')
            return

        folios = dict(Payment.objects.filter(related_topup__in=topups,
                                             status=Payment.Status.SUCCESS)
                      .order_by('created_at', 'pk').values_list('related_topup_id', 'pk'))
        rows, overdue_ids = [], []
        for t in topups:
            try:
                code = t.student.loyverse_profile.customer_code or '-'
            except Exception:  # noqa: BLE001 — no Loyverse profile snapshot yet
                code = '-'
            late = t.apply_due_at <= now - GRACE
            if late:
                overdue_ids.append(t.pk)
            paid = timezone.localtime(t.processed_at) if t.processed_at else None
            rows.append(
                f'- {t.student.user.full_name} · cliente Loyverse {code} · '
                f'{format_amount(t.amount)} · folio {folios.get(t.pk, "-")}'
                + (f' · pagada {paid:%d/%m %H:%M}' if paid else '')
                + f' · se aplica {timezone.localtime(t.apply_due_at):%d/%m %H:%M}'
                + (' · VENCIDA' if late else '')
            )
        for row in rows:
            self.stdout.write(row)
        if no_email:
            return

        ids = [t.pk for t in topups]
        fingerprint = ','.join(map(str, ids)) + '|' + ','.join(map(str, overdue_ids))
        if not _should_notify(fingerprint, bool(overdue_ids), now):
            self.stdout.write('already notified; next reminder later')
            return

        total = sum((t.amount for t in topups), Decimal('0'))
        title = (f'{len(rows)} recarga(s) en línea por cargar en el POS'
                 + (f' ({len(overdue_ids)} vencida(s))' if overdue_ids else ''))
        body = (
            f'Recargas pagadas con tarjeta que aún no están en el saldo de cafetería '
            f'(total {format_amount(total)}):\n\n' + '\n'.join(rows)
            + '\n\nCárguelas en el POS de Loyverse (cliente de cada alumno). En unos minutos '
            'la app las detecta y las aplica; también puede usar Cafetería → POS Loyverse → '
            '«Por aplicar» → «Aplicar». Las marcadas VENCIDA ya pasaron de la hora prometida '
            'a la familia.'
        )
        from apps.portal.models import Notification
        from apps.portal.services import notify, send_email

        people = self._recipients()
        for person in people:
            notify(person, Notification.NotifType.CAFETERIA, title, body,
                   email=False, fanout=False)
        emails = [p.email for p in people if p.email]
        sent = bool(emails) and send_email(f'Interlaken: {title}', body, emails)
        OpsStatus.set(STATE_KEY, {'fingerprint': fingerprint, 'alerted_at': now.isoformat()})
        self.stdout.write(f'notified {len(people)} in-app; email {"sent" if sent else "NOT sent"}')

    @staticmethod
    def _recipients() -> list:
        """Every active admin, and every active staff account whose puesto
        includes the cafetería area: the cashier does the 07:30 load, and
        until 2026-10-29 only admins heard about it."""
        from apps.accounts.models import User

        admins = list(User.objects.filter(role=User.Role.ADMIN, is_active=True))
        cashiers = [u for u in User.objects.filter(role=User.Role.STAFF, is_active=True)
                    if 'cafeteria' in (u.staff_areas or [])]
        return admins + cashiers
