"""
topup_apply_report — the paid online top-ups staff must load into the POS.

With ``CAFETERIA_TOPUP_APPLY_MODE='scheduled'`` a card top-up reaches the
wallet only after staff type it into the Loyverse POS (every school day at
``CAFETERIA_TOPUP_APPLY_TIME``, 07:30). This lists every paid top-up due by
the next hour, oldest first, with what staff need at the POS: student,
Loyverse customer code, amount and folio. Each one marked VENCIDA is past its
promised time: the family was told it would be applied by then. Each one
marked SIN VERIFICAR is a real card approval staff have not matched in
MultiCobros yet (with its número de control): the app does not credit it,
neither the POS mirror nor «Aplicar», until it is verified.

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

        payments = {}
        for p in (Payment.objects.filter(related_topup__in=topups, status=Payment.Status.SUCCESS)
                  .select_related('banorte').order_by('created_at', 'pk')):
            payments[p.related_topup_id] = p      # newest wins
        # ``rows``: the detailed log line (stdout, unchanged); ``lines``: the
        # compact one the staff read in the notice and the email.
        rows, lines, overdue_ids, unverified_ids = [], [], [], []
        for t in topups:
            try:
                code = t.student.loyverse_profile.customer_code or '-'
            except Exception:  # noqa: BLE001 — no Loyverse profile snapshot yet
                code = '-'
            late = t.apply_due_at <= now - GRACE
            if late:
                overdue_ids.append(t.pk)
            payment = payments.get(t.pk)
            # A real approval reported by the parent's browser: the app does not
            # credit it (POS mirror, «Aplicar») until staff match it in MultiCobros.
            unverified = payment is not None and payment.needs_bank_verification()
            if unverified:
                unverified_ids.append(t.pk)
            checkout = payment.banorte_checkout() if payment is not None else None
            paid = timezone.localtime(t.processed_at) if t.processed_at else None
            rows.append(
                f'- {t.student.user.full_name} · cliente Loyverse {code} · '
                f'{format_amount(t.amount)} · folio {payment.pk if payment else "-"}'
                + (f' · pagada {paid:%d/%m %H:%M}' if paid else '')
                + f' · se aplica {timezone.localtime(t.apply_due_at):%d/%m %H:%M}'
                + (' · VENCIDA' if late else '')
                + (' · SIN VERIFICAR: verifique en MultiCobros antes de cargarla'
                   + (f' (número de control {checkout.control_number})' if checkout else '')
                   if unverified else '')
            )
            lines.append(' · '.join(filter(None, [
                t.student.user.full_name, format_amount(t.amount), f'Loyverse {code}',
                f'folio {payment.pk if payment else "-"}',
                'VENCIDA' if late else '',
                ('SIN VERIFICAR' + (f' (control {checkout.control_number})' if checkout else ''))
                if unverified else '',
            ])))
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
        title, body, content = _notice(lines, total, len(overdue_ids), len(unverified_ids))
        from apps.portal.models import Notification
        from apps.portal.services import notify, send_email

        people = self._recipients()
        for person in people:
            notify(person, Notification.NotifType.CAFETERIA, title, body,
                   email=False, fanout=False)
        emails = [p.email for p in people if p.email]
        sent = bool(emails) and send_email(f'Interlaken: {title}', body, emails, content=content)
        OpsStatus.set(STATE_KEY, {'fingerprint': fingerprint, 'alerted_at': now.isoformat()})
        self.stdout.write(f'notified {len(people)} in-app; email {"sent" if sent else "NOT sent"}')

    @staticmethod
    def _recipients() -> list:
        """Every active admin, and every active staff account whose puesto
        includes the cafetería area: the cashier does the 07:30 load, and
        until 2026-10-29 only admins heard about it."""
        from apps.cafeteria.services import cafeteria_staff

        return cafeteria_staff()


def _plural(n: int, one: str, many: str) -> str:
    return f'{n} {one if n == 1 else many}'


def _notice(lines, total, overdue: int, unverified: int):
    """``(title, text, EmailContent)`` of the staff notice: a short title, one
    compact line per top-up, and what to do said once at the end (it was one
    long paragraph until 2026-11-18)."""
    from apps.cafeteria.schedule import format_amount
    from apps.cafeteria.services import PAID_QUEUE_PATH, PAID_QUEUE_WHERE
    from apps.portal.emailing import EmailContent, portal_url

    title = ' · '.join(filter(None, [
        f'{_plural(len(lines), "recarga", "recargas")} por cargar en el POS',
        _plural(overdue, 'vencida', 'vencidas') if overdue else '',
        f'{unverified} sin verificar' if unverified else '',
    ]))
    intro = f'Total {format_amount(total)}. Recargas con tarjeta ya cobradas que aún no están en el saldo:'
    steps = []
    if unverified:
        steps.append('SIN VERIFICAR: búsquela en MultiCobros por su número de control y confírmela '
                     'con «Verificar en MultiCobros». Sin eso no se suma al saldo, aunque ya esté '
                     'en Loyverse.')
    steps.append('Cargue cada monto al cliente de Loyverse del alumno. La app lo aplica solo en unos '
                 'minutos (o use «Aplicar»).')
    todo = [f'{n}. {step}' for n, step in enumerate(steps, 1)]
    if overdue:
        todo.append('VENCIDA: ya pasó la hora prometida a la familia.')
    where = f'En {PAID_QUEUE_WHERE}.'
    body = '\n\n'.join([intro, '\n'.join(f'• {line}' for line in lines),
                        'Qué hacer:\n' + '\n'.join(todo), where])
    content = EmailContent(
        title=title, intro=intro, category='Cafetería',
        tone='warning' if (overdue or unverified) else 'brand',
        items=list(lines), paragraphs=['Qué hacer:', *todo],
        cta_label='Abrir «Por aplicar»', cta_url=portal_url(PAID_QUEUE_PATH),
        link_fallback=False, reason='Aviso interno de la consola del Colegio Interlaken.')
    return title, body, content
