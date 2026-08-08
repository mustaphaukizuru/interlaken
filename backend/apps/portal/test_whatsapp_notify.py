"""Phase D: notify(whatsapp=True) wires WhatsApp Cloud API fail-soft."""
from unittest import mock

import pytest

from apps.accounts.factories import ParentFactory
from apps.portal.models import Notification
from apps.portal.services import notify


@pytest.mark.django_db
class TestWhatsAppNotify:
    def test_sends_when_number_and_flag(self, settings):
        settings.WHATSAPP_TOKEN = 'tok'
        settings.WHATSAPP_PHONE_ID = 'pid'
        parent = ParentFactory(whatsapp='5215512345678')
        with mock.patch('apps.whatsapp.services.send_text', return_value=True) as send:
            notify(parent, Notification.NotifType.CAFETERIA, 'Título', 'Cuerpo',
                   email=False, whatsapp=True)
        send.assert_called_once()
        assert send.call_args.args[0] == '5215512345678'
        assert 'Título' in send.call_args.args[1]

    def test_skips_without_number(self):
        parent = ParentFactory(whatsapp='')
        with mock.patch('apps.whatsapp.services.send_text') as send:
            notify(parent, Notification.NotifType.INFO, 'T', 'M',
                   email=False, whatsapp=True)
        send.assert_not_called()

    def test_flag_false_never_sends(self):
        parent = ParentFactory(whatsapp='5215512345678')
        with mock.patch('apps.whatsapp.services.send_text') as send:
            notify(parent, Notification.NotifType.INFO, 'T', 'M',
                   email=False, whatsapp=False)
        send.assert_not_called()
