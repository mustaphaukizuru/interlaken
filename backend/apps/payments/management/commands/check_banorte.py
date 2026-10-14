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
Suitable for the daily cron next to the other health checks.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.payments.gateways.banorte import BanorteConfig
from apps.payments.gateways.base import LiveCheckoutNotConfigured


class Command(BaseCommand):
    help = "Validate the Banorte VCE configuration and the merchant certificate expiry."

    def add_arguments(self, parser):
        parser.add_argument(
            "--warn-days",
            type=int,
            default=30,
            help="Fail when the certificate expires within this many days.",
        )

    def handle(self, *args, warn_days, **options):
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
            raise CommandError(" | ".join(problems))
        self.stdout.write(self.style.SUCCESS("Banorte: OK"))
