"""
check_loyverse_webhook — alarm for "Loyverse switched our receipts webhook off".

Loyverse disables a webhook after repeated failed deliveries and only tells the
merchant account by email. In October 2026 that happened during a DNS outage,
and hand-made replacements (the bare domain, the path without its secret) kept
failing with 403/401 for days. The 5-minute poll hid it: balances still moved,
only later. This asks the Loyverse API whether a receipts webhook pointing at
OUR secret URL is ENABLED, and names any other webhook aimed at this domain,
since those can only fail and will get Loyverse emailing again.

It only reads. Re-enabling is a human decision in Loyverse; the email says how.
The secret part of the URL is never printed or emailed.
"""
from urllib.parse import urlparse

from django.conf import settings
from django.core.management.base import BaseCommand
from django.urls import reverse
from django.utils import timezone

from apps.cafeteria.services import LoyverseError, get_webhooks
from apps.core.models import OpsStatus
from apps.payments import ops_alerts

ALERT_KEY = 'loyverse_webhook_alert'


class Command(BaseCommand):
    help = 'Alert the admins when the Loyverse receipts webhook is missing or disabled.'

    def add_arguments(self, parser):
        parser.add_argument('--no-email', action='store_true')

    def handle(self, *args, **o):
        secret = (settings.LOYVERSE_WEBHOOK_SECRET or '').strip()
        base = (settings.BACKEND_URL or '').rstrip('/')
        if not (settings.LOYVERSE_API_TOKEN and secret and base):
            self.stdout.write('webhook check skipped: LOYVERSE_API_TOKEN, LOYVERSE_WEBHOOK_SECRET '
                              'or BACKEND_URL not configured')
            return

        expected = base + reverse('cafeteria-loyverse-webhook-token', kwargs={'token': secret})
        domain = urlparse(base).hostname.removeprefix('www.')

        def mask(text: str) -> str:
            return text.replace(secret, '<secreto>')

        try:
            hooks = get_webhooks()
        except LoyverseError as exc:
            # Loyverse unreachable is the poll's alarm (check_sync_fresh), not ours.
            self.stdout.write(f'webhook check skipped: Loyverse API error ({mask(str(exc))[:200]})')
            return

        ours = [h for h in hooks if h.get('type') == 'receipts.update' and h.get('url') == expected]
        enabled = any(h.get('status') == 'ENABLED' for h in ours)
        strays = [h for h in hooks
                  if h.get('status') == 'ENABLED' and h.get('url') != expected
                  and h.get('type') in ('receipts.update', 'customers.update')
                  and domain in (urlparse(h.get('url', '')).hostname or '')]

        OpsStatus.set('loyverse_webhook', {
            'at': timezone.now().isoformat(),
            'receipts_enabled': enabled,
            'receipts_present': bool(ours),
            'strays': [f"{h.get('type')} {mask(h.get('url', ''))}" for h in strays],
        })

        if enabled and not strays:
            self.stdout.write('loyverse webhook OK: receipts.update enabled on the secret URL')
            ops_alerts.clear_alert(ALERT_KEY)
            return

        problems = []
        if not ours:
            problems.append('No existe en Loyverse un webhook de recibos (receipts.update) con la '
                            'dirección correcta de la app.')
        elif not enabled:
            problems.append('El webhook de recibos (receipts.update) con la dirección correcta está '
                            'DESACTIVADO en Loyverse. Las ventas y recargas tardan hasta 5 minutos '
                            'más en llegar a la app.')
        for h in strays:
            problems.append(f"Hay un webhook activo que va a fallar siempre y debe borrarse: "
                            f"{h.get('type')} → {mask(h.get('url', ''))}")
        for line in problems:
            self.stdout.write(self.style.ERROR(f'WEBHOOK: {line}'))

        fingerprint = '|'.join(problems)[:200]
        if o['no_email'] or not ops_alerts.should_alert(ALERT_KEY, fingerprint):
            return
        addressed = ops_alerts.email_admins(
            'Interlaken: revisar el webhook de Loyverse',
            '\n\n'.join(problems) + (
                '\n\nQué hacer: en Loyverse (Back office → Integraciones → Webhooks) active el '
                'webhook de «receipts» cuya dirección termina en /loyverse/webhook/…/ y borre los '
                'demás que apunten a este dominio. No cree webhooks nuevos a mano: la dirección '
                'correcta lleva una clave secreta que solo tiene el servidor.'),
        )
        if addressed:
            ops_alerts.mark_alerted(ALERT_KEY, fingerprint)
        self.stdout.write(f'alert email {"sent" if addressed else "NOT sent"} to {addressed} admin(s)')
