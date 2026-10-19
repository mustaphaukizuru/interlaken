"""
banorte_pending_report — the Banorte operations staff must look up in MultiCobros.

Banorte tells us the outcome only through the parent's browser. When that
answer never arrives (the parent closed the window or lost connection after
paying), or arrives and is not trustworthy, the card may have been charged
while the wallet was not credited. This command lists those operations from
the last ``--hours`` (default 72) and emails the active admins:

- still pending past the checkout window (no final answer yet);
- an answer we did not trust (``BanorteCheckout.last_error``);
- expired without an answer (``stage=expire``);
- superseded by a newer attempt without an answer (``stage=supersede``);
- bank timeout (Payworks ``T``: the issuer did not answer).

The rule is ``payments.multicobros.review_reason``, the same one the admin
deposit log uses. Cancellations inside Banorte's window, authentication errors
and operations staff already closed with "Conciliar con MultiCobros" are left
out. Simulated (AUT/DEC/RND) operations are skipped unless ``--include-tests``.

It runs hourly (deploy/crontab.example), so it only emails when an operation
appears that the last email did not list, plus a daily reminder while any
stays open. ``--no-email`` only prints.

    python manage.py banorte_pending_report [--hours 72] [--include-tests] [--no-email]
"""

from datetime import datetime, timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import OpsStatus
from apps.payments import ops_alerts
from apps.payments.models import BanorteCheckout
from apps.payments.multicobros import review_reason

STATE_KEY = "banorte_pending_report"
# An unchanged list of open operations is re-sent at most this often.
REMIND_EVERY = timedelta(hours=24)


def _should_email(ids: list[int], now) -> bool:
    state = OpsStatus.get(STATE_KEY) or {}
    if set(ids) - set(state.get("reported") or []):
        return True
    try:
        sent = datetime.fromisoformat(state.get("alerted_at") or "")
    except ValueError:
        return True
    return now - sent >= REMIND_EVERY


class Command(BaseCommand):
    help = "List (and email) Banorte operations that need a MultiCobros check."

    def add_arguments(self, parser):
        parser.add_argument("--hours", type=int, default=72)
        parser.add_argument("--include-tests", action="store_true")
        parser.add_argument("--no-email", action="store_true")

    def handle(self, *args, hours, include_tests, no_email, **options):
        now = timezone.now()
        since = now - timedelta(hours=hours)
        checkouts = BanorteCheckout.objects.filter(created_at__gte=since).select_related(
            "payment__related_topup__student__user"
        )
        if not include_tests:
            checkouts = checkouts.filter(mode="PRD")

        rows, ids = [], []
        for checkout in checkouts.order_by("created_at"):
            payment = checkout.payment
            reason = review_reason(payment, checkout, now)
            if reason is None:
                continue
            topup = payment.related_topup
            student = topup.student.user.full_name if topup else "-"
            ids.append(payment.pk)
            rows.append(
                f"- {timezone.localtime(checkout.created_at):%d/%m/%Y %H:%M} · {student} · "
                f"${payment.amount} · número de control {checkout.control_number} "
                f"(pago #{payment.pk}, modo {checkout.mode}): {reason}"
            )

        if not rows:
            if not no_email and OpsStatus.get(STATE_KEY):
                OpsStatus.set(STATE_KEY, {})
            self.stdout.write(f"Banorte: nothing to check in the last {hours} h")
            return
        for row in rows:
            self.stdout.write(row)
        if no_email:
            return
        if not _should_email(ids, now):
            self.stdout.write("already reported; next reminder within 24 h")
            return

        body = (
            f"Operaciones con tarjeta Banorte de las últimas {hours} horas que necesitan "
            "revisión en MultiCobros (Analítica → Reportes → Transacciones Payworks 2, "
            "buscar por número de control):\n\n"
            + "\n".join(rows)
            + "\n\nCiérrelas en el portal: Cafetería → Depósitos, filtro «Por revisar en "
            "MultiCobros», botón «Conciliar con MultiCobros». Si MultiCobros la muestra "
            "APROBADA, capture la referencia, la autorización y el monto: el pago se "
            "registra una sola vez, queda verificado y la recarga pasa a «Por aplicar» "
            "hasta cargarla en el POS. Si no aparece, márquela como «No "
            "aparece en MultiCobros» con una nota. No use un ajuste manual de saldo: si "
            "después llega la respuesta del banco, el saldo se acreditaría dos veces."
        )
        sent = ops_alerts.email_admins(
            f"Interlaken: {len(rows)} pago(s) Banorte por revisar en MultiCobros", body
        )
        if sent:
            OpsStatus.set(STATE_KEY, {"reported": ids, "alerted_at": now.isoformat()})
        self.stdout.write(f'report email {"sent" if sent else "NOT sent"} to {sent} admin(s)')
