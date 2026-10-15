"""
banorte_pending_report — the Banorte operations staff must look up in MultiCobros.

Banorte tells us the outcome only through the parent's browser. When that
answer never arrives (the parent closed the window or lost connection after
paying), or arrives and is not trustworthy, the card may have been charged
while the wallet was not credited. This command lists those operations from
the last ``--hours`` (default 26, so a daily cron overlaps slightly) and emails
the active admins when there is anything to check:

- still pending (no final answer yet);
- expired without an answer (``stage=expire``);
- bank timeout (Payworks ``T``: the issuer did not answer);
- an answer we did not trust (``BanorteCheckout.last_error``).

Cancellations inside Banorte's window and authentication errors are left out:
neither charges anything. Simulated (AUT/DEC/RND) operations are skipped unless
``--include-tests``.

    python manage.py banorte_pending_report [--hours 26] [--include-tests] [--no-email]
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.payments import ops_alerts
from apps.payments.models import BanorteCheckout, Payment

NEEDS_CHECK_STAGES = {"expire", "bank_timeout"}


def _reason(checkout) -> str | None:
    payment = checkout.payment
    raw = payment.gateway_raw if isinstance(payment.gateway_raw, dict) else {}
    stage = raw.get("stage", "")
    if payment.status in (Payment.Status.PENDING, Payment.Status.PROCESSING):
        if checkout.last_error:
            return f"pendiente; respuesta no confiable: {checkout.last_error}"
        return "pendiente, sin respuesta de Banorte"
    if payment.status == Payment.Status.FAILED and stage in NEEDS_CHECK_STAGES:
        if stage == "bank_timeout":
            return "el banco emisor no respondió (Payworks T)"
        return "expiró sin respuesta de Banorte (el padre pudo cerrar la ventana tras pagar)"
    return None


class Command(BaseCommand):
    help = "List (and email) Banorte operations that need a MultiCobros check."

    def add_arguments(self, parser):
        parser.add_argument("--hours", type=int, default=26)
        parser.add_argument("--include-tests", action="store_true")
        parser.add_argument("--no-email", action="store_true")

    def handle(self, *args, hours, include_tests, no_email, **options):
        since = timezone.now() - timedelta(hours=hours)
        checkouts = BanorteCheckout.objects.filter(created_at__gte=since).select_related(
            "payment__related_topup__student__user"
        )
        if not include_tests:
            checkouts = checkouts.filter(mode="PRD")

        rows = []
        for checkout in checkouts.order_by("created_at"):
            reason = _reason(checkout)
            if reason is None:
                continue
            payment = checkout.payment
            topup = payment.related_topup
            student = topup.student.user.full_name if topup else "-"
            rows.append(
                f"- {timezone.localtime(checkout.created_at):%d/%m/%Y %H:%M} · {student} · "
                f"${payment.amount} · número de control {checkout.control_number} "
                f"(pago #{payment.pk}, modo {checkout.mode}): {reason}"
            )

        if not rows:
            self.stdout.write(f"Banorte: nothing to check in the last {hours} h")
            return
        for row in rows:
            self.stdout.write(row)
        if no_email:
            return

        body = (
            f"Operaciones con tarjeta Banorte de las últimas {hours} horas que necesitan "
            "revisión en MultiCobros (Analítica → Reportes → Transacciones Payworks 2, "
            "buscar por número de control):\n\n"
            + "\n".join(rows)
            + "\n\nSi MultiCobros la muestra APROBADA, el cargo se hizo pero el saldo no se "
            "acreditó: acredítelo con un ajuste que cite la referencia Payworks. Si no "
            "aparece o está declinada, no hay nada que hacer."
        )
        sent = ops_alerts.email_admins(
            f"Interlaken: {len(rows)} pago(s) Banorte por revisar en MultiCobros", body
        )
        self.stdout.write(f'report email {"sent" if sent else "NOT sent"} to {sent} admin(s)')
