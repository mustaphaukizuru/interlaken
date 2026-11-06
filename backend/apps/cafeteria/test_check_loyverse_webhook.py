"""check_loyverse_webhook — the alarm for "Loyverse switched our webhook off".

In October 2026 the receipts webhook was disabled during a DNS outage and
hand-made replacements (the bare domain → 403, the path without its secret →
401) failed for days while the 5-minute poll hid it. The check reads the
webhook list, emails the admins once per distinct problem, and never leaks the
secret that is part of the URL.
"""
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import call_command

from apps.accounts.factories import AdminFactory
from apps.cafeteria.services import LoyverseError
from apps.core.models import OpsStatus

SECRET = 'test-webhook-secret'
GOOD = f'https://interlaken.edu.mx/api/v1/cafeteria/loyverse/webhook/{SECRET}/'
TARGET = 'apps.cafeteria.management.commands.check_loyverse_webhook.get_webhooks'


def hook(url, status='ENABLED', type_='receipts.update'):
    return {'id': url[-6:], 'type': type_, 'url': url, 'status': status}


@pytest.fixture
def configured(settings):
    settings.LOYVERSE_API_TOKEN = 'tok'
    settings.LOYVERSE_WEBHOOK_SECRET = SECRET
    settings.BACKEND_URL = 'https://interlaken.edu.mx'


def run(hooks):
    out = StringIO()
    with patch(TARGET, return_value=hooks):
        call_command('check_loyverse_webhook', stdout=out)
    return out.getvalue()


@pytest.mark.django_db
@pytest.mark.usefixtures('configured')
class TestCheckLoyverseWebhook:
    def test_enabled_secret_url_is_quiet(self):
        AdminFactory()
        with patch('apps.portal.services.send_email') as send:
            out = run([hook(GOOD), hook(GOOD, type_='customers.update'),
                       hook('https://core.brand-wallet.com/connection/webhook/loyverse?x=1')])
        assert 'OK' in out
        send.assert_not_called()
        assert OpsStatus.get('loyverse_webhook')['receipts_enabled'] is True

    def test_disabled_webhook_emails_once_then_stays_quiet(self):
        AdminFactory()
        hooks = [hook(GOOD, status='DISABLED')]
        with patch('apps.portal.services.send_email', return_value=True) as send:
            run(hooks)
            run(hooks)
        send.assert_called_once()
        assert 'DESACTIVADO' in send.call_args.args[1]

    def test_names_webhooks_that_can_only_fail_without_leaking_the_secret(self):
        AdminFactory()
        hooks = [hook(GOOD, status='DISABLED'),
                 hook('https://interlaken.edu.mx'),
                 hook('https://interlaken.edu.mx/api/v1/cafeteria/loyverse/webhook/'),
                 hook('https://www.interlaken.edu.mx')]
        with patch('apps.portal.services.send_email', return_value=True) as send:
            out = run(hooks)
        body = send.call_args.args[1]
        assert body.count('debe borrarse') == 3
        assert SECRET not in body and SECRET not in out
        assert SECRET not in str(OpsStatus.get('loyverse_webhook'))

    def test_missing_webhook_is_reported(self):
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            run([])
        assert 'No existe' in send.call_args.args[1]

    def test_recovery_clears_the_alert_so_the_next_outage_emails_again(self):
        AdminFactory()
        with patch('apps.portal.services.send_email', return_value=True) as send:
            run([hook(GOOD, status='DISABLED')])
            run([hook(GOOD)])
            run([hook(GOOD, status='DISABLED')])
        assert send.call_count == 2

    def test_loyverse_api_error_is_not_this_alarm(self):
        AdminFactory()
        out = StringIO()
        with patch(TARGET, side_effect=LoyverseError(f'500 for {GOOD}')), \
             patch('apps.portal.services.send_email') as send:
            call_command('check_loyverse_webhook', stdout=out)
        send.assert_not_called()
        assert 'skipped' in out.getvalue() and SECRET not in out.getvalue()


@pytest.mark.django_db
def test_is_a_no_op_until_configured(settings):
    settings.LOYVERSE_WEBHOOK_SECRET = ''
    out = StringIO()
    with patch(TARGET) as get:
        call_command('check_loyverse_webhook', stdout=out)
    get.assert_not_called()
    assert 'skipped' in out.getvalue()
