"""
check_banorte — is the Banorte checkout able to take a payment right now?

Reports (never prints secrets) the effective Payworks mode, which required
settings are missing, and the merchant certificate's subject, fingerprint and
expiry. Banorte renews that certificate every March; once it expires every
lightbox answers AUT-10, so the command fails ahead of time:

    python manage.py check_banorte            # exit 1 on a blocking problem
    python manage.py check_banorte --warn-days 45

Exit status 1 when: PAYMENTS_LIVE=true with incomplete configuration, the
certificate is unreadable or expired, or it expires within ``--warn-days``.

``--notify`` (used by the daily cron) also emails the active admins, because
the VPS cannot mail cron output: once when a problem appears or changes, then
at most weekly while it lasts.
"""

import re

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.payments import ops_alerts
from apps.payments.gateways.banorte import BanorteConfig
from apps.payments.gateways.base import LiveCheckoutNotConfigured

ALERT_KEY = "banorte_check"


class Command(BaseCommand):
    help = "Validate the Banorte VCE configuration and the merchant certificate expiry."

    def add_arguments(self, parser):
        parser.add_argument(
            "--warn-days",
            type=int,
            default=30,
            help="Fail when the certificate expires within this many days.",
        )
        parser.add_argument(
            "--notify",
            action="store_true",
            help="Email the admins about a problem (once, then weekly while it lasts).",
        )

    def handle(self, *args, warn_days, notify=False, **options):
        config = BanorteConfig.from_settings()
        live = bool(getattr(settings, "PAYMENTS_LIVE", False))
        problems = []

        self.stdout.write(f"PAYMENTS_LIVE: {live}")
        self.stdout.write(f"Modo Payworks efectivo: {config.effective_mode()}")
        self.stdout.write(f'Afiliación: {config.merchant_id or "(sin configurar)"}')

        missing = config.missing()
        if missing:
            self.stdout.write(f'Faltan: {", ".join(missing)}')
            if live:
                problems.append("PAYMENTS_LIVE=true con configuración incompleta.")
            else:
                self.stdout.write("Sin credenciales completas: la recarga usa la página simulada.")

        if config.cert_raw or config.cert_path:
            try:
                cert = config.certificate()
            except LiveCheckoutNotConfigured as exc:
                problems.append(f"Certificado: {exc}")
            else:
                days = cert.days_left()
                self.stdout.write(f"Certificado: {cert.subject}")
                self.stdout.write(f"  SHA-256: {cert.fingerprint}")
                self.stdout.write(f"  Vence: {cert.not_after:%Y-%m-%d %H:%M} UTC ({days} días)")
                if cert.is_expired():
                    problems.append(
                        f"El certificado venció el {cert.not_after:%Y-%m-%d}; "
                        "solicite el vigente a Banorte."
                    )
                elif days < warn_days:
                    problems.append(
                        f"El certificado vence en {days} días; "
                        "solicite el nuevo a Banorte (se renueva en marzo)."
                    )

        if problems:
            if notify:
                self._notify(problems)
            raise CommandError(" | ".join(problems))
        if notify:
            ops_alerts.clear_alert(ALERT_KEY)
        self.stdout.write(self.style.SUCCESS("Banorte: OK"))

    def _notify(self, problems):
        # Day counts change daily; the problem itself does not.
        fingerprint = re.sub(r"\d+", "#", " | ".join(problems))
        if not ops_alerts.should_alert(ALERT_KEY, fingerprint):
            self.stdout.write("already alerted for this problem")
            return
        body = (
            "Los pagos con tarjeta (Banorte) necesitan atención:\n\n"
            + "\n".join(f"- {p}" for p in problems)
            + "\n\nEl certificado de Banorte se renueva cada año en los primeros tres meses: "
            "solicítelo a su ejecutivo de banca Banorte y actualice BANORTE_CERT en el "
            "servidor (docs/BANORTE-INTEGRATION.md, sección 7). Mientras el certificado esté "
            "vencido, las familias no pueden pagar con tarjeta."
        )
        sent = ops_alerts.email_admins("Interlaken: pagos con tarjeta Banorte", body)
        if sent:
            ops_alerts.mark_alerted(ALERT_KEY, fingerprint)
        self.stdout.write(f'alert email {"sent" if sent else "NOT sent"} to {sent} admin(s)')
